const db = require('./index');

async function withTransaction(fn) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (error) {
    try {
      await conn.rollback();
    } catch (rollbackError) {
      console.error('Error realizando rollback:', rollbackError);
    }
    throw error;
  } finally {
    conn.release();
  }
}

module.exports = { withTransaction };
