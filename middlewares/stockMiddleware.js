// stockController.js
const db = require('../controllers/db'); 

const actualizarStock = (productId, quantityChange, transactionType) => {
    return new Promise((resolve, reject) => {
        
        const operator = quantityChange >= 0 ? '+' : '-';
        const absoluteQuantityChange = Math.abs(quantityChange);

        const query = `
            UPDATE productos
            SET stock_actual = stock_actual ${operator} ?
            WHERE id = ?;
        `;

        db.query(query, [absoluteQuantityChange, productId], (err, result) => {
            if (err) {
                console.error(`Error updating stock for product ${productId} (${transactionType}):`, err);
                return reject(err);
            }
            if (result.affectedRows === 0) {
                // If no rows were affected, it means the product ID might not exist
                return reject(new Error(`Product with ID ${productId} not found.`));
            }
            console.log(`Stock updated for product ${productId}. Change: ${quantityChange}, Type: ${transactionType}`);
            resolve(result);
        });
    });
};


const obtenerStock = (productId) => {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT stock_actual FROM productos
            WHERE id = ?;
        `;
        db.query(query, [productId], (err, results) => {
            if (err) {
                console.error(`Error fetching stock for product ${productId}:`, err);
                return reject(err);
            }
            if (results.length === 0) {
                return reject(new Error(`Product with ID ${productId} not found.`));
            }
            resolve(results[0].stock_actual);
        });
    });
};


module.exports = {
    actualizarStock,
    obtenerStock,
};