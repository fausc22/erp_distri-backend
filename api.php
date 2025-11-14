<?php
// ============================================
// API PROXY MEJORADO - PUNTOSUR
// ============================================
// Este archivo actúa como proxy entre el frontend y el backend Node.js
// Maneja CORS, query parameters, y servicio de archivos multimedia
// ============================================

// Configurar CORS headers
header('Access-Control-Allow-Origin: https://mycarrito.com.ar');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');
header('Access-Control-Allow-Credentials: true');

// Manejar peticiones OPTIONS (preflight)
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

// ============================================
// OBTENER RUTA Y PARÁMETROS
// ============================================

// Obtener la ruta solicitada
$path = $_GET['path'] ?? '';

// 🔑 IMPORTANTE: Construir query string SIN el parámetro 'path'
// Esto evita que 'path' se envíe como parámetro al backend
parse_str($_SERVER['QUERY_STRING'] ?? '', $queryParams);
unset($queryParams['path']); // Eliminar 'path' de los parámetros

$queryString = http_build_query($queryParams);

// URL del backend interno
$url = 'http://127.0.0.1:4000/' . $path;
if (!empty($queryString)) {
    $url .= '?' . $queryString;
}

// Log para debugging (opcional - comentar en producción)
// error_log("API Proxy: {$_SERVER['REQUEST_METHOD']} {$url}");

// ============================================
// CONFIGURAR cURL
// ============================================

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 30);
curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $_SERVER['REQUEST_METHOD']);

// ============================================
// HEADERS
// ============================================

$headers = [];

// Detectar si es FormData (multipart) o JSON
$contentType = $_SERVER['CONTENT_TYPE'] ?? '';
if (strpos($contentType, 'multipart/form-data') !== false) {
    // Para FormData, NO enviar Content-Type (cURL lo maneja automáticamente)
    // Solo pasar otros headers
} else if (!empty($contentType)) {
    $headers[] = 'Content-Type: ' . $contentType;
} else if (in_array($_SERVER['REQUEST_METHOD'], ['POST', 'PUT', 'PATCH'])) {
    // Por defecto, JSON para POST/PUT/PATCH
    $headers[] = 'Content-Type: application/json';
}

// Pasar otros headers importantes
foreach ($_SERVER as $key => $value) {
    if (strpos($key, 'HTTP_') === 0 && $key !== 'HTTP_HOST') {
        $header = str_replace('_', '-', substr($key, 5));
        // Excluir headers que no deben pasarse
        if (!in_array(strtolower($header), ['host', 'content-length', 'content-type'])) {
            $headers[] = $header . ': ' . $value;
        }
    }
}

if (!empty($headers)) {
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
}

// ============================================
// CUERPO DE LA PETICIÓN
// ============================================

// Manejar cuerpo de la petición para POST/PUT/PATCH
if (in_array($_SERVER['REQUEST_METHOD'], ['POST', 'PUT', 'PATCH'])) {
    $body = file_get_contents('php://input');
    if ($body) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    }
}

// ============================================
// EJECUTAR PETICIÓN
// ============================================

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$contentType = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);

// Manejo de errores de cURL
if (curl_error($ch)) {
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode([
        'error' => 'Backend connection failed',
        'details' => curl_error($ch),
        'url' => $url
    ]);
    curl_close($ch);
    exit();
}

curl_close($ch);

// ============================================
// DEVOLVER RESPUESTA
// ============================================

http_response_code($httpCode);

// Establecer Content-Type apropiado
if ($contentType) {
    header('Content-Type: ' . $contentType);
}

// Para archivos multimedia, agregar headers adicionales
if (strpos($contentType, 'video/') !== false ||
    strpos($contentType, 'audio/') !== false) {

    // Headers para streaming de video/audio
    header('Accept-Ranges: bytes');
    header('Cache-Control: public, max-age=31536000'); // Cache de 1 año

    // Si es una petición de rango (streaming)
    if (isset($_SERVER['HTTP_RANGE'])) {
        http_response_code(206); // Partial Content
    }
}

echo $response;
?>
