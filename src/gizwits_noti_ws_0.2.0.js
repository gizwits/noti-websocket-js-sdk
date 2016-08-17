// enterpriseId = <string>
// enterpriseSecret = <string>
// subscribeEvent = [
//			{
//				"product_key": <string>, 
//              "macs": [<string>],
//				"events": ["device.online", "device.offline", "device.attr_fault", "device.attr_alert", "device.status.raw", "device.status.kv"]
//			}
//		]
// prefetchCount = <int>
function GizwitsNotiWS(enterpriseId, enterpriseSecret, wsHost, wsPort, subscribeEvent, prefetchCount)
{
    this.onConnected = undefined;
    this.onSubscribed = undefined;
    this.onEvent = undefined;
    this.onError = undefined;

    this._eid = enterpriseId;
    this._esecret = enterpriseSecret;
    this._wsHost = wsHost;
    this._wsPort = wsPort;
    this._prefetchCount = prefetchCount;
    this._subscribeEvent = subscribeEvent;
    this._socketType = "ssl_socket";
    this._connection = undefined;
    this._heartbeatInterval = 60;
}

function Connection(wsInfo, gizwitsNotiWs)
{
    this._wsUrl = "{0}/ws/noti/v1".format(wsInfo);
    this._websocket = undefined;
    this._heartbeatTimerId = undefined;
    this._loginFailedTimes = 0;
    this._maxReloginTimes = 3;
    this._callbackObj = gizwitsNotiWs;
}

//=========================================================
// api functions
//=========================================================
GizwitsNotiWS.prototype.connect = function()
{
    var me = this;
    
    var wsInfo = me._getWebsocketConnInfo();
    var conn = me._connection;
    if (conn == null)
    {
        conn = new Connection(wsInfo, me);
    }
    if (conn._websocket == null || conn._websocket.readyState != conn._websocket.OPEN)
    {
        conn._connectWS();
        me._connection = conn;
    }
    else
    {
        if (me._subscribeEvent)
        {
            conn._subEvents();
        }
    }
};

GizwitsNotiWS.prototype.subscribe = function(subscribeEvent)
{
    var me = this;
    me._subscribeEvent = subscribeEvent;
    var conn = me._connection;
    if (conn !== null && conn !== undefined)
    {
        conn._subEvents();
    }
};

//=========================================================
// inner functions
//=========================================================
GizwitsNotiWS.prototype._getWebsocketConnInfo = function()
{
    var me = this;
    var pre = "wss://";
    var host = "noti.gizwits.com";
    var port = 2016;
    if(me._wsHost){
        host = me._wsHost;
    }
    if(me._wsPort){
        port = me._wsPort;
    }
    if (me._socketType == "socket")
    {
        pre = "ws://";
    }
    return pre + host + ":" + port;
};

GizwitsNotiWS.prototype._sendError = function(msg)
{
    if(this.onError)
    {
        this.onError(msg);
    }
};
//=========================================================
// websocket functions
//=========================================================
Connection.prototype._connectWS = function()
{
    var conn = this;

    var websocket = new WebSocket(conn._wsUrl);
    websocket.onopen = function(evt) {conn._onWSOpen(evt)};
    websocket.onclose = function(evt) {conn._onWSClose(evt)};
    websocket.onmessage = function(evt) {conn._onWSMessage(evt)};
    websocket.onerror = function(evt) {conn._onWSError(evt)};

    conn._websocket = websocket;
};

Connection.prototype._onWSOpen = function(evt)
{
    var conn = this;
    conn._login();
};

Connection.prototype._onWSClose = function(evt)
{
    var conn = this;
    conn._stopPing();
    conn._callbackObj._sendError("Websocket Connect failed, please try again after a moment.");
};

Connection.prototype._onWSMessage = function(evt)
{
    var conn = this;
    var res = JSON.parse(evt.data);
    switch(res.cmd)
    {
        case "enterprise_pong":
            break;
        case "enterprise_login_res":
            if(res.data.result == true)
            {
                conn._loginFailedTimes = 0;
                conn._startPing();
                if (conn._callbackObj.onConnected)
                {
                    conn._callbackObj.onConnected();
                }
                if (conn._callbackObj._subscribeEvent)
                {
                    conn._subEvents();
                }
            }
            else
            {
                conn._callbackObj._sendError("Login failed with msg: " + res.data.msg);
                conn._callbackObj._sendError("Login will try again, please wait...");
                conn._tryLoginAgain();
            }
            break;
        case "enterprise_subscribe_res":
            if(res.data.result == true)
            {
                if (conn._callbackObj.onSubscribed)
                {
                    conn._callbackObj.onSubscribed();
                }
            }
            else
            {
                conn._callbackObj._sendError("subscribe error with msg: " + res.data.msg);
            }        
            break;
        case "enterprise_event_push":
            if (conn._callbackObj.onEvent)
            {
                var deliveryId = res.delivery_id;
                delete res.delivery_id;
                conn._callbackObj.onEvent(res);
                conn._ackEvent(deliveryId);
            }
            break;
    }
};

Connection.prototype._onWSError = function(evt)
{
    var conn = this;
    conn._callbackObj._sendError("Websocket on error");
};

Connection.prototype._login = function()
{
    var conn = this;
    var data;
    if(conn._callbackObj._prefetchCount == undefined){
        data = {
            enterprise_id: conn._callbackObj._eid,
            enterprise_secret: conn._callbackObj._esecret
        }
    } else {
        data = {
            enterprise_id: conn._callbackObj._eid,
            enterprise_secret: conn._callbackObj._esecret,
            prefetch_count: conn._callbackObj._prefetchCount
        }
    }
    var json =
        {
            cmd: "enterprise_login_req",
            data: data
        };
    conn._sendJson(json);
};

Connection.prototype._subEvents = function()
{
    var conn = this;
    var json =
        {
            cmd: "enterprise_subscribe_req",
            data: conn._callbackObj._subscribeEvent
        };
    conn._sendJson(json);
};

Connection.prototype._startPing = function()
{
    var conn = this;
    var heartbeatInterval = conn._callbackObj._heartbeatInterval * 1000;
    conn._heartbeatTimerId = window.setInterval(function(){conn._sendJson({cmd: "enterprise_ping"})}, heartbeatInterval);
};

Connection.prototype._stopPing = function()
{
    var conn = this;
    window.clearInterval(conn._heartbeatTimerId);
};

Connection.prototype._ackEvent = function(deliveryId)
{
    var conn = this;
    var json =
        {
            cmd: "enterprise_event_ack",
            delivery_id: deliveryId
        };
    conn._sendJson(json);
};

Connection.prototype._sendJson = function(json)
{
    var conn = this;
    var data = JSON.stringify(json);
    var websocket = conn._websocket;
    if (websocket.readyState == websocket.OPEN)
    {
        websocket.send(data);
        return true;
    }
    else
    {
        console.log("Send data error, websocket is not connected.");
        return false;
    }
};

Connection.prototype._tryLoginAgain = function()
{
    var conn = this;
    conn._loginFailedTimes += 1;
    if (conn._loginFailedTimes > conn._maxReloginTimes)
    {
        conn._websocket.close();
        return;
    }
    var waitTime = conn._loginFailedTimes * 5000;
    window.setTimeout(function() { conn._login() }, waitTime);
};

String.prototype.format = function()
{
    var args = arguments;
    return this.replace(/\{(\d+)\}/g,
        function(m,i)
        {
            return args[i];
        });
};
