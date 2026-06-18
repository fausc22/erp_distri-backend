const { query, run } = require('../db/connectionQuery');

class BaseRepository {
  async query(sql, params = [], connection = null) {
    return query(sql, params, connection);
  }

  async run(sql, params = [], connection = null) {
    return run(sql, params, connection);
  }

  async queryOne(sql, params = [], connection = null) {
    const rows = await query(sql, params, connection);
    return rows?.[0] || null;
  }

  async insert(sql, params = [], connection = null) {
    const result = await query(sql, params, connection);
    return result?.insertId || null;
  }

  async update(sql, params = [], connection = null) {
    const result = await query(sql, params, connection);
    return result?.affectedRows || 0;
  }

  async remove(sql, params = [], connection = null) {
    const result = await query(sql, params, connection);
    return result?.affectedRows || 0;
  }
}

module.exports = BaseRepository;
