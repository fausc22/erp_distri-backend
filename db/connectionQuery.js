const db = require('./index');

async function query(sql, params = [], connection = null) {
  if (connection) {
    const [rows] = await connection.query(sql, params);
    return rows;
  }

  const [rows] = await db.query(sql, params);
  return rows;
}

/** Para bulk inserts (VALUES ?) y otros casos que requieren .query */
async function run(sql, params = [], connection = null) {
  if (connection) {
    const [result] = await connection.query(sql, params);
    return result;
  }

  const conn = await db.getConnection();
  try {
    const [result] = await conn.query(sql, params);
    return result;
  } finally {
    conn.release();
  }
}

module.exports = { query, run };
