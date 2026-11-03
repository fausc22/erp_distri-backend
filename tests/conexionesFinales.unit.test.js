const assert = require('node:assert/strict');
const {resolverImportes}=require('../dominio/calculo/sombra');
const {aplicarLineas,validarDocumento,validarVistaPrevia,payloadCalculo}=require('../dominio/calculo/documento');
async function run() {
  process.env.MOTOR_CALCULO_VERSION='v1';
  const {previewImportes}=await import('../../frontend/utils/calculo/preview.js');
  const {transformarAFormatoARCA}=await import('../arca-microservice/utils/formatters.js');
  for (const [productos,descuentoGlobal] of [
    [[{precio:1000,cantidad:1,porcentaje_iva:21}],null],
    [[{precio:1000,cantidad:1,porcentaje_iva:21}],{tipo:'porcentaje',valor:10}],
    [[{precio:1000,cantidad:1,porcentaje_iva:21}],{tipo:'monto',valor:121}],
    [[{precio:'1000.123456',cantidad:'2.333',porcentaje_iva:21}],null],
    [[{precio:1000,cantidad:1,porcentaje_iva:21,descuento_porcentaje:10},
      {precio:1000,cantidad:1,porcentaje_iva:10.5}],{tipo:'porcentaje',valor:5}],
    [[{precio:0.05,cantidad:1,porcentaje_iva:21},{precio:0.05,cantidad:1,porcentaje_iva:21}],null]
  ]) {
    const result=resolverImportes({productos,descuentoGlobal});
    const preview=previewImportes(productos,descuentoGlobal);
    assert.equal(preview.total,result.importes.total);
    const lines=aplicarLineas(productos,result);
    const venta={subtotal:result.importes.subtotal_str,iva_total:result.importes.iva_total_str,total:result.importes.total_str};
    validarDocumento(venta,lines,result.resultado);
    validarVistaPrevia(result,preview.total);
    assert.throws(()=>validarVistaPrevia(result,preview.total+1),{code:'PREVIEW_DESACTUALIZADA'});
    const payload={...payloadCalculo(result.resultado),tipoComprobante:1,fecha:20261103,cliente:{tipoDocumento:80,numeroDocumento:'20111111112',condicionIVA:1}};
    const fiscal=transformarAFormatoARCA(payload,1,4);
    assert.equal(fiscal.ImpTotal,result.importes.total);
    assert.throws(()=>transformarAFormatoARCA({...payload,impTotal:'999999.00'},1,4));
  }
  assert.throws(()=>resolverImportes({productos:[{precio:100,cantidad:1,porcentaje_iva:99}]}),{code:'CALCULO_INVALIDO'});
  assert.throws(()=>resolverImportes({productos:[{precio:100,cantidad:0,porcentaje_iva:21}]}),{code:'CALCULO_INVALIDO'});
  process.env.MOTOR_CALCULO_VERSION='sombra';
  assert.equal(resolverImportes({productos:[{precio:100,cantidad:1,porcentaje_iva:99}]}).usarMotor,false);
  const {normalizarConsulta,validarRecuperacionAutomatica}=require('../services/consultaFiscal');
  const esperado={CbteTipo:1,PtoVta:4,CbteDesde:123,DocTipo:80,DocNro:20111111112,CbteFch:20261103,
    ImpTotal:121,ImpNeto:100,ImpIVA:21,ImpTrib:0,ImpOpEx:0,ImpTotConc:0};
  const consulta=normalizarConsulta({codAutorizacion:'70000000000001',cbteDesde:123,docTipo:80,docNro:20111111112,
    cbteFch:20261103,impTotal:121,impNeto:100,impIVA:21,impTrib:0,impOpEx:0,impTotConc:0},
    {tipo:1,puntoVenta:4,numero:123});
  assert.equal(validarRecuperacionAutomatica(consulta,esperado),true);
  assert.throws(()=>validarRecuperacionAutomatica({...consulta,DocNro:20333333334},esperado),/Reconciliar/);
  assert.throws(()=>validarRecuperacionAutomatica({...consulta,ImpTotal:122},esperado),/Reconciliar/);
  assert.throws(()=>validarRecuperacionAutomatica({...consulta,DocTipo:undefined},esperado),/Reconciliar/);
  assert.throws(()=>validarRecuperacionAutomatica({...consulta,consulta_identidad:null},esperado),/Reconciliar/);
  console.log('OK recuperación automática: identidad vinculada a consulta, importes y faltantes');
  console.log('OK frontend/motor/detalle/formatter: vectores compartidos, validación y modo sombra');
}
run().catch(e=>{ console.error(e);process.exitCode=1; });
