/*
 * Copyright (C) 2013 Freie Universität Berlin
 *
 * This file subject to the terms and conditions of the GLGPLv2 License. See the file LICENSE in the
 * top level directory for more details.
 */

/**
 * @fileoverview    The riot-tv reporter gathers data about routes and package transmission in riot based
 *                  6LowPAN WSNs.
 *
 * @date            Okt 2013
 * @author          Hauke Petersen <hauke.petersen@fu-berlin.de>
 */

/**
 * Configuration
 */
const DEFAULT_ANCHOR_HOST = 'localhost';        /* address of the anchor */
const DEFAULT_ANCHOR_PORT = 23511;              /* targeted port on the anchor */
const DEFAULT_SERIAL_PORT= '/dev/ttyUSB0';      /* serial port to open */
const DEFAULT_COMM_TYPE= 'uart';                /* default communication type */

/**
 * Library imports
 */
var net = require('net');
var JsonSocket = require('json-socket');
var serialPort = require('serialport');
var SerialPort = serialPort.SerialPort;

/**
 * Global variables
 */
var host = DEFAULT_ANCHOR_HOST;
var port = DEFAULT_ANCHOR_PORT;
var dev = DEFAULT_SERIAL_PORT;
var socket = new JsonSocket(new net.Socket());  /* connection to the anchor */
var isConnected = false;                        /* flag signals if the reporter is connected to the anchor */
var commType = DEFAULT_COMM_TYPE;
var comm;

/**
 * Parse communication type, host and port from command line arguments
 *
 * Usage: node reporter.js [COMM-TYPE] [DEV] [ANCHOR-HOST] [ANCHOR-PORT]
 */
function parseCommandLineArgs() {
    process.argv.forEach(function(arg, index) {
        switch (index) {
            case 2:
                commType = arg;
            break;
            case 3:
                dev = arg;
            break;
            case 4:
                host = arg;
            break;
            case 5:
                port = arg;
            break;
        }
    });
}

/**
 * Reporting section
 * (event handlers for the TCP connection)
 */
function connect() {
    if (!isConnected) {
        console.log("SOCKET: Trying to connect to " + host + ':' + port);
        socket.connect(port, host);
    }
}

socket.on('connect', function() {
    console.log('SOCKET: Reporting live from the RIOT');
    isConnected = true;
});

socket.on('close', function(error) {
    if (!error) {
        console.log('SOCKET: Lost connection to the anchor, will try to call back');
        isConnected = false;
        connect();
    }
});

socket.on('error', function() {
    console.log('SOCKET: Unable to reach the anchor, will try again in 1s');
    setTimeout(connect, 1000);
});

socket.on('message', function(data) {
    console.log('COMMAND: ' + data.data);
    comm.write(data.data + "\n");
});

function registerDataEvent(comm, commType) {
    console.log('SERIAL: Let the journalism begin, covering the RIOT - live');
    comm.on('data', function(data){
        var time = new Date().getTime();
        console.log(commType + ':    ' + data);
        if (isConnected) {
            socket.sendMessage({'type': 'raw', 'data': data, 'time': time});
        }
    });
}

/**
 * Bootstrapping and starting the reporter
 */
console.log("RIOT-TV Reporter");
console.log("Usage: $node reporter.js [uart|socket] [tty*|port] [ANCHOR-HOST] [ANCHOR-PORT]");
parseCommandLineArgs();
console.log("INFO:   Connecting to device on " + dev + " and anchor at " + host + ":" + port);
connect();

if (commType === 'uart') {
    comm = new SerialPort(dev, {
        'baudrate': 115200,
        'databits': 8,
        'parity': 'none',
        'stopbits': 1,
        'parser': serialPort.parsers.readline("\n")},
        false);                         /* connection to the sensor node over UART */

    /**
     * Open the serial port.
     * (event handlers for the serial port)
     */
    uart.open(function() {
        registerDataEvent(comm, commType);
    });
}
else if (commType === 'socket'){
    comm = net.connect({ port: dev });  /* connection to the sensor node over a TCP-Socket */
    registerDataEvent(comm, commType);
}
