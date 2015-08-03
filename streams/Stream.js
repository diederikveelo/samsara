define(function(require, exports, module) {
    var EventHandler = require('famous/core/EventHandler');
    var EventMapper = require('famous/events/EventMapper');
    var SimpleStream = require('famous/streams/SimpleStream');
    var dirtyObjects = require('famous/core/dirtyObjects');

    var nextTickQueue = require('famous/core/queues/nextTickQueue');
    var postTickQueue = require('famous/core/queues/postTickQueue');
    var dirtyQueue = require('famous/core/queues/dirtyQueue');
    var State = require('famous/core/SUE');

    var EVENTS = {
        START : 'start',
        UPDATE : 'update',
        END : 'end',
        RESIZE : 'resize'
    };

    function Stream(options){
        this._eventInput = new EventHandler();
        this._eventOutput = new EventHandler();
        EventHandler.setInputHandler(this, this._eventInput);
        EventHandler.setOutputHandler(this, this._eventOutput);

        options = options || {};

        var batchCount = 0;
        var batchTotal = 0;
        var total = 0;

        var self = this;

        var dirty = false;
        this._eventInput.on('start', function(){
            if (dirty) return;
            dirtyObjects.trigger('dirty');
            dirty = true;
        });

        this._eventInput.on('end', function(){
            if (!dirty) return;
            dirtyObjects.trigger('clean');
            dirty = false;
        });

        this._eventInput.on(EVENTS.START, function(data){
            batchCount++;
            batchTotal++;
            total++;
            (function(currentCount){
                nextTickQueue.push(function streamStart(){
                    if (currentCount == batchTotal){
                        var payload = options.start ? options.start(data) : data;
                        if (payload !== false) self.emit(EVENTS.START, payload);
                        batchCount = 0;
                        batchTotal = 0;
                    }
                });
            })(batchCount)
        });

        this._eventInput.on(EVENTS.UPDATE, function(data){
            batchCount++;
            batchTotal++;
            (function(currentCount){
                postTickQueue.push(function streamUpdate(){
                    if (currentCount == batchTotal) {
                        var payload = options.update ? options.update(data) : data;
                        if (payload !== false) self.emit(EVENTS.UPDATE, payload);
                        batchCount = 0;
                        batchTotal = 0;
                    }
                });
            })(batchCount);
        });

        this._eventInput.on(EVENTS.END, function(data){
            batchCount++;
            batchTotal++;
            total--;
            (function(currentCount){
                dirtyQueue.push(function streamEnd(){
                    if (currentCount === batchTotal && total == 0){
                        var payload = options.end ? options.end(data) : data;
                        if (payload !== false) self.emit(EVENTS.END, payload);
                        batchCount = 0;
                        batchTotal = 0;
                    }
                });
            })(batchCount);
        });

        this._eventInput.on(EVENTS.RESIZE, function(data){
            switch (State.get()){
                case State.STATES.START:
                    self.trigger(EVENTS.START, data);
                    break;
                case State.STATES.UPDATE:
                    self.trigger(EVENTS.UPDATE, data);
                    break;
                case State.STATES.END:
                    self.trigger(EVENTS.END, data);
                    break;
            }
        });
    }

    Stream.prototype = Object.create(SimpleStream.prototype);
    Stream.prototype.constructor = Stream;

    Stream.lift = SimpleStream.lift;

    Stream.merge = function(streamObj){
        var mergedStream = new Stream();
        var mergedData = (streamObj instanceof Array) ? [] : {};

        mergedStream.addStream = function(key, stream){
            mergedData[key] = undefined;
            var mapper = (function(key){
                return new EventMapper(function(data){
                    mergedData[key] = data;
                    return mergedData;
                });
            })(key);

            mergedStream.subscribe(mapper).subscribe(stream);
        };

        for (var key in streamObj){
            var stream = streamObj[key];
            mergedStream.addStream(key, stream);
        }

        return mergedStream;
    };

    module.exports = Stream;
});
