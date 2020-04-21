/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
var app = {
    /**
     * DATA
     */
    scan_retries: 0,
    max_retries: 4,
    search_counter: 0,
    search_list: [],
    redraw_counter: 0,
    devices: [],
    repeat_seconds: 20,
    log_history: [],
    max_history: 400,
    online: false,
    connectionState: "unknown",
    ip: '0.0.0.0',
    abortSignal: false,
    ip_range_start: null,
    ip_range_end: null,
    startBtn: document.querySelector('button#find'),
    abortBtn: document.querySelector('button.cancel'),
    loaderTimeout: 0,
    progressTimeout: 0,

    // Application Constructor
    initialize: function() {
        document.addEventListener('deviceready', this.onDeviceReady.bind(this), false);
    },

    // deviceready Event Handler
    //
    // Bind any cordova events here. Common events are:
    // 'pause', 'resume', etc.
    onDeviceReady: function() {
        app.trace();
        app.checkConnection();
        document.addEventListener("reload", this.reload, false);
        document.addEventListener("offline", this.onOffline, false);
        document.addEventListener("online", this.onOnline, false);
        document.addEventListener("details", this.onMoreInfo, false);
        document.addEventListener("click", this.abort, false);
        
        app.displayResults(app.getSavedResults());

        // handle all clicks on document
        document.addEventListener('click', function (event) {
            var parent_list_item = getClosest(event.target, '.list_item');
            if (event.target.matches('#find')) {
                event.preventDefault();
                app.startSearch();
            } else if (event.target.matches('button.cancel')) {
                event.preventDefault();
                app.abortSearch();
            } else if (event.target.classList.contains('list_item') || parent_list_item) {
                event.preventDefault();
                var href = (parent_list_item && parent_list_item.href) ? parent_list_item.href: event.target.href;
                document.dispatchEvent(new CustomEvent('details', {detail: href}));
            } else {
                // no matches. carry on as normal..
            }
        }, false);
    },
    checkConnection: function() {
        app.trace();

        var networkState = navigator.connection.type;
        var states = {};
        states[Connection.UNKNOWN]  = 'Unknown connection';
        states[Connection.ETHERNET] = 'Ethernet connection';
        states[Connection.WIFI]     = 'WiFi connection';
        states[Connection.CELL_2G]  = 'Cell 2G connection';
        states[Connection.CELL_3G]  = 'Cell 3G connection';
        states[Connection.CELL_4G]  = 'Cell 4G connection';
        states[Connection.CELL]     = 'Cell generic connection';
        states[Connection.NONE]     = 'No network connection';
        app.connectionState = states[networkState];

        // not "unknown" or "none" then must be online
        if([Connection.UNKNOWN,Connection.NONE].indexOf(networkState) === -1) {
            app.onOnline();
        } else {
            app.onOffline();
        }
    },
    onOffline: function() {
        app.trace();
        app.online = false;
        document.body.classList.toggle('online', app.online);
        app.showIpAddress();
    },
    onOnline: function() {
        app.trace();
        app.online = true;
        document.body.classList.toggle('online', app.online);
        app.showIpAddress();
    },
    // open web browser window with emoncms interface
    onMoreInfo: function(event) {
        url = event.detail;
        var ref = window.open(url,'_blank', 'location=yes');
    },
    showIpAddress: function() {
        this.trace();
        const container = document.getElementById("ip-address");
        if(app.online) {
            container.innerText = "Getting IP address...";
            WifiWizard2.getWifiIP()
            .then(function(ip) {
                app.ip = ip;
                app.info(`getWifiIP() response = ${ip}`);
                if(container) container.innerText = `Connected as ${ip}`;
            })
            .catch(function(reason) {
                app.error(reason);
                if(container) container.innerText = "Not connected";
            });
        } else {
            container.innerText = "OFFLINE";
        }
    },
    /**
     * call the findAll() function and react to the returned values
     */
    startSearch: function() {
        app.trace();
        app.startLoader();
        app.abortAllSearches = new AbortController();
        app.search_counter = 0;
        if(app.startBtn) app.startBtn.classList.add("d-none");
        if(app.abortBtn) app.abortBtn.classList.remove("d-none");
        app.findAll()
            .then(function(responses) {
                const results = responses.filter(Boolean);
                app.log(`Found ${results.length}`);
                if(results.length>0) {
                    app.saveResults(results);
                    app.displayResults(results);
                } else {
                    const list = document.getElementById("list");
                    list.innerHTML = '<div class="alert"><h4>0 Results</h4><p>Please ensure the device is connected to the network before re-trying.</p></div>';
                    app.startBtn.innerText = 'Retry';
                }
            })
            .catch(error=>console.error(error))
            .finally(()=>{
                app.endSearch();
            })
    },
    displayResults: function(results) {
        if (!results) return;
        const list = document.getElementById("list");
        const list_item = document.createElement("a");
        list.innerHTML = "";
        results.forEach(node=> {
            if(!node) return;
            var item = list_item.cloneNode();
            item.classList.add('list_item');
            try {
                item.innerHTML = `${node.response}<small class="badge text-muted">${node.ip}</small>`;
            } catch (error) {
                console.error(error);
            }
            item.href=`http://${node.ip}/`;
            if (node.response==='emoncms') item.href=`http://${node.ip}/emoncms`;
            list.append(item);
        });
    },
    abortSearch: function() {
        app.trace();
        app.abortAllSearches.abort()
        app.endSearch();
    },
    endSearch: function() {
        app.stopLoader();
        app.hideProgress();
        if(app.startBtn) app.startBtn.classList.remove("d-none");
        if(app.abortBtn) app.abortBtn.classList.add("d-none");
    },
    /**
     * search the current subnet by triggering ajax requests to each possible value
     * eg from 192.168.1.0 to 192.168.1.255
     * @returns {Promise} array of responses or error string
     */
    findAll: function() {
        app.trace();
        var allRequests = app.getIpRange().map(host=> {
            return app.ping(host)
                        .then(res=>res)
                        .then(app.showProgress())
                        .catch(error=>{app.error(error)});
        });
        // wait for all to respond before displaying list
        return Promise.all(allRequests)
            .then(response=>response)
            .catch(error=>error);

    },
    saveResults: function(results) {
        var storage = window.localStorage;
        storage.setItem('results', JSON.stringify(results));
        storage.setItem('results_age', new Date().valueOf());
    },
    getSavedResults: function(){
        var storage = window.localStorage;
        var age = parseInt(storage.getItem('results_age')) || new Date().valueOf();
        var ttl = 30 * 60 * 1000; // 30mins in ms
        var results = [];
        // if cache not expired load values
        if(age + ttl > new Date().valueOf()){
            results = storage.getItem('results');
            if (results) results = JSON.parse(results);
            if (results) results = results.unique();
        }
        return results;
    },
    /**
     * test emoncms response for given ip address
     * 
     * @param {string} ip ipv4 address
     * @returns {Object} result
     * @returns {string} result.ip
     * @returns {string} result.response
     */
    ping: function(ip) {
        if (typeof ip === "undefined") throw "No IP address given";
        const url = `http://${ip}/emoncms/describe`;
        const options = {
            signal: app.abortAllSearches.signal,
            cors: "cors"
        }
        return timeout(fetch(url, options), 2000)
            .then(response=> {
                // throw error if response code not in the 200's...
                if (!response.ok) {
                    throw Error(response.statusText);
                }
                return response;
            })
            .then(response=> {
                // if response is well formed json, parse it and return.
                if(response.headers.get('content-type')==='application/json') {
                    return response.json().then(text=>{
                        return {ip:ip, response:text}
                    });
                } else {
                // if not "application/json", read as "text/plain"
                    return response.text().then(text=>{
                        return {ip:ip, response:text}
                    });
                }
            })
            .catch(error=>{
                if(error.name === "AbortError") {
                    // user cancelled search
                } else if (error.name === "TypeError") {
                    // returned value not text or json
                } else if (error.name === "TimeoutError") {
                    // timed out
                } else {
                    // other error.
                }

            })
            .finally(()=>{app.progress()});
    },
    showProgress: function() {
        // show running total
        var progress = document.querySelector("#progress");
        if(progress) progress.classList.add("in");
        var progressBar = document.querySelector('#progress-bar');
        if(progressBar) progressBar.classList.add("in");
    },
    hideProgress: function() {
        // hide running total
        var progress = document.querySelector("#progress");
        if(progress) progress.classList.remove("in");
        var progressBar = document.querySelector('#progress-bar');
        if(progressBar) progressBar.classList.remove("in");
    },
    progress: function() {
        // update the progress
        app.progressTimeout = setTimeout(()=>{
            app.search_counter++;
            var searchCounter = document.querySelector('#counter');
            if(searchCounter) searchCounter.innerText = app.search_counter;
            var totalToSearch = document.querySelector('#total');
            if(totalToSearch) totalToSearch.innerText = app.search_list.length;

            var progress = document.querySelector('#progress-bar');
            progress.max = app.search_list.length;
            progress.value = app.search_counter;
            
        }, 2000/app.search_list.length)
    },
    
    /**
     * return list of ip addresses to search
     * will take the devices ip and search from `start` to (and including) `end`
     * defaults `app.ip_range_start` and `app.ip_range_end` if `start` and `end` not set
     * else defaults to full range (`start`=1 and `end`=254)
     * eg. ["192.168.1.1","192.168.1.2","192.168.1.3","192.168.1.4",...]
     * @param {Number} start ipv4 last octet value in decimal
     * @param {Number} end ipv4 last octet value in decimal
     * @returns {Array} 
     */
    getIpRange: function(start, end) {
        const list = [];
        const range_start = app.ip_range_start || start || 1;
        const range_end = app.ip_range_end || end || 254;
        const parts = app.ip.split('.');
        if (parts.length !== 4) return [];
        for(let i=range_start;i<range_end+1;i++) {
            list.push([parts[0], parts[1], parts[2], i].join("."));
        }
        app.search_list = list;

        return list;
    },

    log: function(text) {
        const container = document.getElementById("debug");
        const output = container.querySelector("#output");
        const last_entry = container.querySelector("summary .last-entry");

        if (typeof container === "undefined"  || typeof output === "undefined") return;
        var isAtBottom = output.scrollTop >= output.scrollHeight-output.clientHeight;
        app.log_history = app.log_history.slice(-Math.abs(app.max_history));
        app.log_history.push(text);
        output.innerHTML = app.log_history.join("<br>");
        // shift up if alredy at bottom
        if(isAtBottom) {
            output.scrollTop = output.scrollHeight;
        }
        // put the last line on the dropdown handle
        var tmp = document.createElement("div");
        tmp.innerHTML = app.log_history.slice(-1).join("");
        if(last_entry) last_entry.innerText = tmp.innerText;
    },
    trace: function(depth) {
        if(typeof depth === "undefined") depth = 1;
        try{
            var lines = new Error().stack.match(/at (.*?) /g).map(line => line.match(/at .*\.(.*?) /)[1]).slice(depth).reverse();
            if (lines.length > 0) {
                app.log("<em>"+lines.join("->") + "()</em>");
            }
        } catch (error) {
            // app.info("ERROR: unable to print trace: " + error.message);
        }
    },
    error: function(text) {
        app.trace();
        app.log("<mark>ERROR: " + text + "</mark>");
        console.error(text);
    },
    info: function(text) {
        app.log("<strong>INFO: " + text + "</strong>");
    },
    startLoader: function(action) {
        app.updateLoader(action||'Searching');
    },
    stopLoader: function() {
        app.updateLoader('');
    },
    updateLoader: function(text){
        const loader = document.getElementById("loader");
        clearTimeout(app.loaderTimeout);
        if(loader) {
            if (text === "") {
                loader.classList.remove('in');
                app.loaderTimeout = setTimeout(()=>{loader.innerHTML = ""}, 800);
            } else {
                loader.innerHTML = text;
                loader.classList.add('in');
            }
        }
    }
};

app.initialize();


// Display alert if js error encountered
window.onerror = function(msg, source, lineno, colno, error) {
    app.stopLoader();

    if (msg.toLowerCase().indexOf("script error") > -1) {
        app.error("Script Error: See Browser Console for Detail");
    } else {
        var maskedSource = source;
        var messages = [
            "JS Error",
            '-------------',
            "Message: " + msg,
            "Line: " + lineno,
            "Column: " + colno,
            '-------------'
        ];
        if (Object.keys(error).length > 0) {
            messages.push("Error: " + JSON.stringify(error));
        }
        app.error('JS:' + messages.join("<br>"));
    }
    return true; // true == prevents the firing of the default event handler.
}


/**
 * Return nearest parent matching `selector`.
 * Searches up DOM `elem` parentNode() tree for given `selector`
 * @param {HTMLElement} elem child element
 * @param {String} selector css query to match potential parent
 * @returns {HTMLElement} parent/closest element that matches | or null
 */
var getClosest = function (elem, selector) {
    for ( ; elem && elem !== document; elem = elem.parentNode ) {
        if ( elem.matches( selector ) ) return elem;
    }
    return null;
};

/**
 * wrap promise in another promise to provide a timeout
 * 
 * @param {Promise} promise object to reject on timeout
 * @param {Number} ms Milliseconds, default 1000
 */
function timeout(promise, ms) {
    if (typeof ms === "undefined") ms = 1000;
    return new Promise(function(resolve, reject) {
        setTimeout(function() {
            var error = new Error("timeout");
            error.name = "TimeoutError"
            reject(error);
        }, ms)
        promise.then(resolve, reject)
    })
}

Object.defineProperty(Array.prototype, 'unique', {
    enumerable: false,
    configurable: false,
    writable: false,
    value: function() {
        var a = this.concat();
        for(var i=0; i<a.length; ++i) {
            for(var j=i+1; j<a.length; ++j) {
                if(a[i] === a[j])
                    a.splice(j--, 1);
            }
        }
        return a;
    }
});