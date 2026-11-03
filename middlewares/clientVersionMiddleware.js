const parseVersion = (value) => String(value || '')
  .trim()
  .split('.')
  .map((part) => Number.parseInt(part, 10))
  .map((part) => (Number.isFinite(part) ? part : 0));

const compareVersions = (current, required) => {
  const a = parseVersion(current);
  const b = parseVersion(required);
  const len = Math.max(a.length, b.length, 3);
  for (let i = 0; i < len; i += 1) {
    const av = a[i] || 0;
    const bv = b[i] || 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
};

const requireClientVersion = (min) => {
  const requiredVersion = min || process.env.MIN_CLIENT_VERSION_UUID_REQUIRED || '2.0.0';

  return (req, res, next) => {
    const clientVersion = req.get('X-App-Version');

    if (!clientVersion || compareVersions(clientVersion, requiredVersion) < 0) {
      return res.status(422).json({
        success: false,
        code: 'CLIENT_UPDATE_REQUIRED',
        message: `Debe actualizar la aplicación a la versión ${requiredVersion} o superior`
      });
    }

    return next();
  };
};

const requireClientVersionWhenUuidRequired = (min) => {
  const middleware = requireClientVersion(min);

  return (req, res, next) => {
    if (String(process.env.REQUIRE_CLIENT_UUID || '').toLowerCase() !== 'true') {
      return next();
    }
    return middleware(req, res, next);
  };
};

module.exports = {
  requireClientVersion,
  requireClientVersionWhenUuidRequired
};
