const db = require('./index');

const normalizeArgs = (params, callback) => {
  if (typeof params === 'function') {
    return { params: [], callback: params };
  }
  return { params: params || [], callback };
};

async function query(sql, params, callback) {
  const args = normalizeArgs(params, callback);
  try {
    const [rows] = await db.query(sql, args.params);
    if (typeof args.callback === 'function') {
      return args.callback(null, rows);
    }
    return rows;
  } catch (error) {
    if (typeof args.callback === 'function') {
      return args.callback(error);
    }
    throw error;
  }
}

function getConnection(callback) {
  if (typeof callback === 'function') {
    db.getConnection()
      .then((conn) => callback(null, conn))
      .catch((error) => callback(error));
    return;
  }
  return db.getConnection();
}

function beginTransaction(callback) {
  db.getConnection()
    .then(async (conn) => {
      try {
        await conn.beginTransaction();
        callback(null, conn);
      } catch (error) {
        conn.release();
        callback(error);
      }
    })
    .catch((error) => callback(error));
}

module.exports = {
  query,
  execute: (sql, params = []) => db.execute(sql, params),
  getConnection,
  connect: (callback) => {
    db.getConnection()
      .then((conn) => {
        conn.release();
        if (callback) callback(null);
      })
      .catch((err) => callback?.(err));
  },
  beginTransaction,
  end: () => db.end(),
  pool: db.pool
};
