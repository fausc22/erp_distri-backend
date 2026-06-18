/**
 * Normalización de paginación para consultas SQL con LIMIT/OFFSET.
 */

const toPositiveInt = (value, fallback) => {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/**
 * @param {object} query - req.query
 * @param {{ defaultPage?: number, defaultPageSize?: number, minPageSize?: number, maxPageSize?: number }} opts
 */
const parsePagination = (query = {}, opts = {}) => {
  const {
    defaultPage = 1,
    defaultPageSize = 50,
    minPageSize = 1,
    maxPageSize = 200
  } = opts;

  const pagina = Math.max(1, toPositiveInt(query.pagina, defaultPage));
  const porPagina = Math.min(
    maxPageSize,
    Math.max(minPageSize, toPositiveInt(query.porPagina, defaultPageSize))
  );
  const offset = (pagina - 1) * porPagina;

  return { pagina, porPagina, offset };
};

/**
 * @param {object} query - req.query
 * @param {{ defaultLimit?: number, maxLimit?: number }} opts
 */
const parseLimit = (query = {}, opts = {}) => {
  const { defaultLimit = 100, maxLimit = 500 } = opts;
  const limit = Math.min(maxLimit, Math.max(1, toPositiveInt(query.limit, defaultLimit)));
  const offset = Math.max(0, parseInt(query.offset, 10) || 0);
  return { limit, offset };
};

module.exports = {
  parsePagination,
  parseLimit,
  toPositiveInt
};
