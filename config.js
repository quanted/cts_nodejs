// Configuration for cts_nodejs.
// Things like host, ports, etc.
// (np) Oct. 2016


var config = {};

// nodejs server config
config.server = {
	'host': process.env.NODEJS_HOST || 'localhost',
	'port': process.env.NODEJS_PORT || 4000
};

// cts-django config
config.cts = {
	'host': process.env.DJANGO_HOST || 'localhost',
	'port': process.env.DJANGO_PORT || 8081,
	'path': process.env.DJANGO_PATH || '/cts/portal'
};

// redis config:
config.redis = {
	'host': process.env.REDIS_HOST || 'localhost',
	'port': process.env.REDIS_PORT || 6379
};

module.exports = config;  // makes config obj a module!