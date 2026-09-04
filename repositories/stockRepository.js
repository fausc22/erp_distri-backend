const BaseRepository = require('./BaseRepository');

class StockRepository extends BaseRepository {
  async incrementarStock(productoId, cantidad, connection = null) {
    return this.update(
      'UPDATE productos SET stock_actual = stock_actual + ? WHERE id = ?',
      [cantidad, productoId],
      connection
    );
  }
}

module.exports = new StockRepository();
