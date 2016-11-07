// var config = require('./config');
// // var node_server = require('./node_server');  // importing CTS request func
// var path = require('path');
// var express = require('express');
// var app = express();

var config = require('./config');

var querystring = require('querystring');
// var redis = require('redis');
var http = require('http');
var io = require('socket.io');
var path = require('path');

var express = require('express');
var app = express()
    , server = http.createServer(app)
    , io = io.listen(server);

server.listen(config.server.port);

// app.get('/', function(req, res){
//   res.send('hello world');
// });

app.get('/test', function(req, res) {
    res.sendFile(path.join(__dirname + '/public/html/ws_test_page.html'));
});

// app.listen(config.server.test_port);

// var http = require('http');
// var server = http.createServer().listen(config.server.port);
// var io = require('socket.io').listen(server);

// console.log("web socket connection at http://localhost:" + config.server.port);
// console.log("test nodejs http connection at http://localhost:" + config.server.test_port);

io.sockets.on('connection', function (socket) {

    console.log("session id: " + socket.id);

    // for web socket testing:
    socket.on('test_socket', function (message) {
        console.log("node received message: ");
        console.log(message);
        socket.send("hello from nodejs! at " + config.server.host + ", port " + config.server.port);
    });

    // test django-cts celery worker
    socket.on('test_celery', function (message) {
        console.log("received message: " + message);
        var query = querystring.stringify({
            sessionid: socket.id, // cts will now publish to session channel
            message: message
        });
        passRequestToCTS(query);
    });

    socket.on('disconnect', function () {
        console.log("user " + socket.id + " disconnected..");
    });

});


function passRequestToCTS (values) {
    var options = {
        host: config.cts.host,
        port: config.cts.port,
        path: config.cts.path,
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': values.length
        }
    };
    // Send message to CTS server:
    var req = http.request(options, function(res){
        res.setEncoding('utf8');        
        // Print out error message:
        res.on('data', function(message){
            if(message != 'Everything worked :)'){
                console.log('Message: ' + message);
            } 
        });
    });
    req.write(values);
    req.end();
}