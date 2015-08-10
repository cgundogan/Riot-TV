/*
 * Copyright (C) 2013 Freie Universität Berlin
 *
 * This file subject to the terms and conditions of the GLGPLv2 License. See the file LICENSE in the  
 * top level directory for more details.
 */

/**
 * @fileoverview    Basic functionality for RIOT TV
 *
 * @author          Hauke Petersen <hauke.petersen@fu-berlin.de>
 */

/**
 * Some global variables
 */
var socket = undefined;
var isConnected = false;
var s, term, ip2nodeId = {};

g = {
    nodes: [],
    edges: []
};

/**
 * Bootstrap the whole javascript klim-bim only after the page was fully loaded
 */
$(document).ready(function() {
    initSocket();
    $("#console-button").click(function(){
        $(this).toggleClass("show hide");
        $("#console").slideToggle();
        if ($(this).hasClass("hide")) {
            term.focus();
        }
    });
    $(document).bind('keydown', function(e) {
        if (e.keyCode === 27) {
            $("#console-button").click();
            e.preventDefault();
        };
    });
    $("#console-input").bind('keydown', function(e) {
        if (e.keyCode === 13) {
            $("#console-send").click();
            e.preventDefault();
        };
    });
    jQuery(function($, undefined) {
        term = $('#console').terminal(function(command, term) {
            if (command !== '') {
                var cmd = {};
                cmd.nodes = s.graph.nodes().filter(function (n) {
                    return n.selected;
                });
                cmd.cmd = command;
                socket.emit('command', cmd);
            } else {
               term.echo('');
            }
        }, {
            greetings: 'RIOT-TV Shell',
            name: 'console',
            height: 500,
            prompt: '> '
        });
    });
});

/**
 * Setup a websocket connection to the anchor for receiving events and register event handlers.
 */
function initSocket() {
    socket = io.connect();
    socket.on('connect', function() {
        isConnected = true;
    });
    socket.on('connect_failed', function() {
        console.log('Connection to localhost failed');
    });
    socket.on('error', function(error) {
        console.log('Error: ' + error);
    });
    socket.on('graphInit', function(data) {
        onGraphInit(data);
    });
    socket.on('nodesInfo', function(data) {
        onNodesInfo(data);
    });
    socket.on('command_output', function(data) {
        onCommandOutput(data);
    });
    socket.on('ifconfig', function(data) {
        onIfconfig(data);
    });
    socket.on('fib', function(data) {
        onFib(data);
    });
    socket.on('IFCONFIG_ADDR_ADD', function(data) {
        onIfconfigAdd(data);
    });
    socket.on('IFCONFIG_ADDR_DEL', function(data) {
        onIfconfigDel(data);
    });
    socket.on('FIB_ROUTE_ADD', function(data) {
        onFibRouteAdd(data);
    });
    socket.on('FIB_ROUTE_DEL', function(data) {
        onFibRouteDel(data);
    });
    socket.on('DIS_RECEIVED', function(data) {
        onDISReceived(data);
    });
};

function onGraphInit(data) {
    g.nodes = data.nodes;
    g.endes = data.edges;
    s = new sigma({
        graph: g,
        renderer: {
            container: document.getElementById('tvscreen'),
            type: 'canvas'
        },
        settings: {
            labelThreshold: '0',
            defaultEdgeType: 'curve',
            defaultEdgeArrow: 'target',
            defaultNodeColor: "#666",
            defaultLabelColor: "#CCC",
            doubleClickEnabled: false,
            defaultEdgeArrow: 'target',
            animationsTime: '200'
        }
    });
    s.bind('clickNode', function(e) {
        e.data.node.selected ^= true;
        if (e.data.node.selected) {
            e.data.node.color = "#B55";
        }
        else {
            e.data.node.color = s.settings.defaultNodeColor;
        }
        s.refresh();
    });
    s.bind('doubleClickStage', function(e) {
        s.graph.nodes().forEach(function(n) {
            n.selected = false;
            n.color = s.settings.defaultNodeColor;
        });
        s.refresh();
    });
};

function onNodesInfo(data) {
    data.forEach(function(node) {
        s.graph.addNode(node);
    });
    s.refresh();
};

function onCommandOutput(output) {
    if (output.slice(-1) === '\n') {
        output = output.slice(0,-1);
    }
    term.echo(output);
};

function onIfconfig(data) {
    var n = s.graph.nodes(data.node);
    if (n) {
        n.ifconfig = {};
        n.ifconfig.iface = {};
        n.ifconfig.iface[data.iface] = { 'addrs' : [] };

        data.addrs.forEach(function(addr) {
            n.ifconfig.iface[data.iface].addrs.push(addr);
            ip2nodeId[addr.split("/")[0]] = data.node;
        });
    }
};

function onIfconfigAdd(data) {
    var n = s.graph.nodes(data.node);
    if (n) {
        if (n.ifconfig === undefined) {
            n.ifconfig = {};
            n.ifconfig.iface = {};
            n.ifconfig.iface[data.iface] = { 'addrs' : [] };
        }

        n.ifconfig.iface[data.iface].addrs.push(data.ipaddr);
        ip2nodeId[data.ipaddr.split("/")[0]] = data.node;
    }
};

function onIfconfigDel(data) {
    var n = s.graph.nodes(data.node);
    if (n) {
        if (n.ifconfig !== undefined) {
            n.ifconfig.iface[data.iface].addrs = n.ifconfig.iface[data.iface].addrs.filter(function(e) {
                return (e.indexOf(data.ipaddr) === -1);
            });
        }
        delete ip2nodeId[data.ipaddr.split("/")[0]];
    }
};

function onFibRouteAdd(data) {
    var n = s.graph.nodes(data.node);
    if (n) {
        if ((n.fib === undefined) || (n.fib.entries === undefined)) {
            n.fib = { 'entries' : [] };
        }

        n.fib.entries.push({ 'dst': data.dst, 'nextHop' : data.nextHop });
        addEdge('fib', data.node, data.dst, data.nextHop, hashStringToColor(data.dst));
    }
};

function onFibRouteDel(data) {
    var n = s.graph.nodes(data.node);
    if (n) {
        if ((n.fib !== undefined) && (n.fib.entries !== undefined)) {
            delEdge('fib', data.node, data.dst);
            n.fib.entries = n.fib.entries.filter(function(e) {
                return e.dst !== data.dst;
            });
        }
    }
};

function onFib(data) {
    var n = s.graph.nodes(data.node);
    if (n) {
        if ((n.fib !== undefined) && (n.fib.entries !== undefined)) {
            n.fib.entries.forEach(function(e) {
                delEdge('fib', n.id, e.dst);
            });
        }
        n.fib = { 'entries' : [] };

        data.entries.forEach(function(e) {
            n.fib.entries.push(e);
            addEdge('fib', data.node, e.dst, e.nextHop, hashStringToColor(e.dst));
        });
        onDISReceived(data);
    }
};

function onDISReceived(data) {
    var n = s.graph.nodes(data.node);
    //var from = ip2nodeId[data.fromIp];
    var from = true;
    if ((n !== undefined) && (from !== undefined)) {
        sigma.plugins.animate(
                s, { size: 'animate_size' },
                {   nodes: [ n ],
                    onComplete: function() {
                        sigma.plugins.animate(s, { size: 'default_size' }, { nodes: [n] });
                    }
                }
        );
    }
};

function delEdge(prefix, source, dst) {
    nextHop = s.graph.nodes(source).fib.entries.filter(function (e) {
        return e.dst == dst;
    });
    if (nextHop.length === 0) {
        return;
    }
    nextHop = nextHop[0].nextHop;
    var target = ip2nodeId[nextHop.split("/")[0]];
    if (target) {
        if (s.graph.edges(prefix + '-' + source + '-' + target)) {
            s.graph.dropEdge(prefix + '-' + source + '-' + target);
            s.refresh();
        }
    }
};

function addEdge(prefix, source, dst, nextHop, color) {
    var target = ip2nodeId[nextHop.split("/")[0]];
    if (target) {
        var edge = { 'id': prefix + '-' + source + '-' + target, 'source': source, 'target': target, 'type': 'arrow' };
        if (color) {
            edge.color = color;
        }
        if (s.graph.edges(edge.id) === undefined) {
            if (dst === "::") {
                s.graph.addEdge(edge);
            }
        }
        s.refresh();
    }
};

function djb2(str){
    var hash = 5381;
    for (var i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) + str.charCodeAt(i); /* hash * 33 + c */
    }
    return hash;
}

function hashStringToColor(str) {
    var hash = djb2(str);
    var r = (hash & 0xFF0000) >> 16;
    var g = (hash & 0x00FF00) >> 8;
    var b = hash & 0x0000FF;
    return "#" + ("0" + r.toString(16)).substr(-2) + ("0" + g.toString(16)).substr(-2) + ("0" + b.toString(16)).substr(-2);
}
