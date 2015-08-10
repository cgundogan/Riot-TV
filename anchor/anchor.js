/*
 * Copyright (C) 2013 Freie Universität Berlin
 *
 * This file subject to the terms and conditions of the GLGPLv2 License. See the file LICENSE in the  
 * top level directory for more details.
 */

/**
 * @fileoverview    Definition of configuration values and bootstrapping the application
 *
 * @author          Hauke Petersen <hauke.petersen@fu-berlin.de>
 */

/**
 * Setup the base configuration
 */
const APP_PORT = 12345;
const BACKEND_PORT = 23511;
const APP_DIR = __dirname + '/app';
const ROOT_DIR = __dirname + '/root';
const LAYOUT_DIR = __dirname + '/data';
const DEFAULT_LAYOUT = LAYOUT_DIR + '/layout.json';

/**
 * include packages
 */
var express = require('express');
var app = express();
var server = require('http').createServer(app);
var io = require('socket.io').listen(server);
var favicon = require('serve-favicon');

/**
 * define global variables
 */
var clients = [];   // list of clients connected to the anchor
var reporter = {};
var nodes = [];
var edges = [];

/**
 * Setup static routes for img, js, css and the favicon
 */
app.use('/img', express.static(ROOT_DIR + '/img'));
app.use('/js', express.static(ROOT_DIR + '/js'));
app.use('/css', express.static(ROOT_DIR + '/css'));
app.use('/data', express.static(ROOT_DIR + '/data'));
app.use(favicon(ROOT_DIR + '/img/favicon.ico'));

/**
 * Setup one generic route that always points to the index.html
 */
app.get('/*', function(req, res) {
    res.sendFile(__dirname + '/views/index.html');
});


/**
 * Configure the socket.io interface
 * 
 * When a new client is connecting, a initial node list is send to it. Later it receives 
 * all update information.
 */
io.set('log level', 1);
io.sockets.on('connection', function(socket) {
    clients.push(socket);
    socket.on('command', function(data) {
        sendToReporter('command', data);
    });
    socket.emit('graphInit', {'nodes': nodes, 'edges': edges });
});

function publish(type, data) {
    clients.forEach(function(socket) {
        socket.emit(type, data);
    });
}

function sendToReporter(type, data) {
    if (reporter.socket !== undefined) {
        reporter.socket.sendMessage({'type': type, 'data': data});
    }
};

/**
 * Start the backend
 */
var net = require('net');
var JsonSocket = require('json-socket');

var serverSocket = net.createServer(function(basicSocket) {
    console.log('SOCKET: Reporter connected from: ' + basicSocket.remoteAddress + ':' + basicSocket.remotePort);
    sock = new JsonSocket(basicSocket);
    // create reporter id
    var id = basicSocket.remoteAddress + ":" + basicSocket.remotePort;
    reporter = {'socket': sock, 'station': false, 'info': {}};

    sock.on('message', function(data) {
        parseData(data);
    });

    sock.on('error', function(error) {
        console.log(error);
    });
    sock.on('close', function(test) {
        reporter = {};
        nodes = [];
        edges = [];
        console.log('SOCKET: Reporter disconnected: ' + id);
    });
});

function startBackend(port) {
    serverSocket.listen(port, function() {
        console.log('SOCKET: Backend socket started at port ' + port);
    });
};

function parseData(data) {
    switch (data.type) {
        case "RTV":
            publish(data.subType, data);
            break;
        case "command_output":
            publish('command_output', data.output);
            break;
        case "ifconfig":
            publish('ifconfig', data);
            break;
        case "fib":
            publish('fib', data);
            break;
        case "nodesInfo":
            nodes = data.data;
            publish('nodesInfo', data.data);
            break;
    }
};

/**
 * Bootstrap and start the application
 */
startBackend(BACKEND_PORT);
server.listen(APP_PORT, function() {
    console.info('WEBSERVER: Running at http://127.0.0.1:' + APP_PORT + '/');
});
