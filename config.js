// Configuration for cts_nodejs.
// Things like host, ports, etc.
// (np) Oct. 2016


var config = {};

console.log("envs: " + process.env);

// nodejs server config
config.server = {
	'host': process.env.NODEJS_HOST || 'localhost',
	'port': process.env.NODEJS_PORT || 4000
};

// redis config:
config.redis = {
	'host': process.env.REDIS_HOSTNAME || 'localhost',
	'port': process.env.REDIS_PORT || 6379
};

module.exports = config;  // makes config obj a module!