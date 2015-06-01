// Library imports
var WebSocket = require('ws');

// Project imports
var Packet = require('./packet');
var PlayerTracker = require('./PlayerTracker');
var PacketHandler = require('./PacketHandler');
var Entity = require('./entity');

// GameServer implementation
function GameServer(port,gameMode) {
    this.lastNodeId = 1;
    this.clients = [];
    this.port = port;
    this.nodes = [];
    this.nodesVirus = []; // Virus nodes
    this.nodesPlayer = []; // Nodes controlled by players
    
    this.currentFood = 0;
    this.currentTick = 0; // For move engine, eating calculations are calculated every 10 ticks (500 ms)
    this.movingNodes = []; // For move engine
    this.leaderboard = [];
    
    this.gameMode = gameMode;
    
    this.border = { // Vanilla border values are - top: 0, left: 0, right: 111180.3398875, bottom: 11180.3398875,
        left: 0,
        right: 6000.0,
        top: 0,
        bottom: 6000.0
    }; // Right: X increases, Down: Y increases (as of 2015-05-20)
    this.config = {
        serverMaxConnections: 64, // Maximum amount of connections to the server. 
        serverAllowMods: true, // Whether or not to allow clients with mods to connect
        serverViewBase: 1000, // Base view distance of each player (Warning: High values may cause lag)
        serverViewMod: 2.5, // View distance is increased by each cell's radius multiplied by this config value
        serverBots: 0, // Amount of player bots to spawn (Private feature)
        foodSpawnRate: 1000, // The interval between each food cell spawn in milliseconds
        foodSpawnAmount: 5, // The amount of food to spawn per interval
        foodMaxAmount: 500, // Maximum food cells on the map
        foodMass: 25, // Starting food size (In mass)
        virusMinAmount: 10, // Minimum amount of viruses on the map. 
        virusMaxAmount: 50, // Maximum amount of viruses on the map. If this amount is reached, then ejected cells will pass through viruses.
        virusStartMass: 100.0, // Starting virus size (In mass)
        virusBurstMass: 198.0, // Viruses explode past this size
        ejectMass: 16, // Mass of ejected cells
        ejectMassGain: 14, // Amount of mass gained from consuming ejected cells
        ejectSpeed: 170, // Base speed of ejected cells
        playerStartMass: 30, // Starting mass of the player cell.
        playerMaxMass: 225000, // Maximum mass a player can have
        playerMinMassEject: 32, // Mass required to eject a cell
        playerMinMassSplit: 36, // Mass required to split
        playerMaxCells: 16, // Max cells the player is allowed to have
        playerRecombineTime: 15, // Amount of ticks before a cell is allowed to recombine (1 tick = 2000 milliseconds) - currently 30 seconds
        playerMassDecayRate: .004, // Amount of mass lost per tick (Multiplier) (1 tick = 2000 milliseconds)
        playerMinMassDecay: 9, // Minimum mass for decay to occur
        playerSpeedMultiplier: 0.7, // Speed multiplier. Values higher than 1.0 may result in glitchy movement.
        leaderboardUpdateInterval: 2000, // Time between leaderboard updates, in milliseconds
        leaderboardUpdateClient: 40 // How often leaderboard data is sent to the client (1 tick = 50 milliseconds)
    };
	
    this.colors = [{'r':235,'b':0,'g':75},{'r':225,'b':255,'g':125},{'r':180,'b':20,'g':7},{'r':80,'b':240,'g':170},{'r':180,'b':135,'g':90},{'r':195,'b':0,'g':240},{'r':150,'b':255,'g':18},{'r':80,'b':0,'g':245},{'r':165,'b':0,'g':25},{'r':80,'b':0,'g':145},{'r':80,'b':240,'g':170},{'r':55,'b':255,'g':92}]; 
}

module.exports = GameServer;

GameServer.prototype.start = function() {
    // Gamemode configurations
    this.gameMode.onServerInit(this);
	
    // Start the server
    this.socketServer = new WebSocket.Server({ port: this.port }, function() {
        // Update player
        setInterval(this.updateAll.bind(this), 50);
        
        // Spawning
        setInterval(this.spawnFood.bind(this), this.config.foodSpawnRate);
        this.virusCheck();
        
        // Move engine
        setInterval(this.updateMoveEngine.bind(this), 50);
        setInterval(this.updateCells.bind(this), 2000);
        
        // Leaderboard
        setInterval(this.updateLeaderboard.bind(this), this.config.leaderboardUpdateInterval);
        
        // Done
        console.log("[Game] Listening on port %d", this.port);
        console.log("[Game] Current game mode is "+this.gameMode.name);
        
        // Player bots (Experimental)
        if (this.config.serverBots > 0) {
            console.log("[Game] Loaded "+this.bots.clients.length+" player bots");
        }
    }.bind(this));

    this.socketServer.on('connection', connectionEstablished.bind(this));

    function connectionEstablished(ws) {
        if (this.clients.length > this.config.serverMaxConnections) {
            ws.close();
            console.log("[Game] Client tried to connect, but server player limit has been reached!");
            return;
        }
    	
        function close(error) {
            console.log("[Game] Disconnect: %s:%d", this.socket.remoteAddress, this.socket.remotePort);
            var index = this.server.clients.indexOf(this.socket);
            if (index != -1) {
                this.server.clients.splice(index, 1);
            }
            
            // Switch online flag off
            this.socket.playerTracker.setStatus(false);
        }

        console.log("[Game] Connect: %s:%d", ws._socket.remoteAddress, ws._socket.remotePort);
        ws.remoteAddress = ws._socket.remoteAddress;
        ws.remotePort = ws._socket.remotePort;
        ws.playerTracker = new PlayerTracker(this, ws);
        ws.packetHandler = new PacketHandler(this, ws);
        ws.on('message', ws.packetHandler.handleMessage.bind(ws.packetHandler));

        var bindObject = { server: this, socket: ws };
        ws.on('error', close.bind(bindObject));
        ws.on('close', close.bind(bindObject));
        this.clients.push(ws);
    }
}

GameServer.prototype.getMode = function() {
    return this.gameMode;
}

GameServer.prototype.getNextNodeId = function() {
	// Resets integer
    if (this.lastNodeId > 2147483647) {
        this.lastNodeId = 1;
    }
    return this.lastNodeId++;
}

GameServer.prototype.getRandomPosition = function() {
    return {
        x: Math.floor(Math.random() * (this.border.right - this.border.left)) + this.border.left,
        y: Math.floor(Math.random() * (this.border.bottom - this.border.top)) + this.border.top
    };
}

GameServer.prototype.getRandomColor = function() {
    var index = Math.floor(Math.random() * this.colors.length);
    var color = this.colors[index];
    return {
        r: color.r,
        b: color.b,
        g: color.g
    };
}

GameServer.prototype.addNode = function(node) {
    this.nodes.push(node);
    
    // Special on-add actions
    node.onAdd(this);
    
    // Adds to the owning player's screen
    if (node.owner){
        node.owner.socket.sendPacket(new Packet.AddNodes(node));
    }
    
    // Add to visible nodes
    for (var i = 0; i < this.clients.length;i++) {
        client = this.clients[i].playerTracker;
        if (!client) {
            continue;
        }

        if (node.collisionCheck(client.viewBox.bottomY,client.viewBox.topY,client.viewBox.rightX,client.viewBox.leftX)) {
            client.visibleNodes.push(node);
        }
    }
}

GameServer.prototype.removeNode = function(node) {
    // Remove from main nodes list
    var index = this.nodes.indexOf(node);
    if (index != -1) {
        this.nodes.splice(index, 1);
    }
    
    // Remove from moving cells list
    index = this.movingNodes.indexOf(node);
    if (index != -1) {
    	this.movingNodes.splice(index, 1);
    }
    
	// Special on-remove actions
    node.onRemove(this);
    
    // Animation when eating
    for (var i = 0; i < this.clients.length;i++) {
        client = this.clients[i].playerTracker;
        if (!client) {
            continue;
        }

        // Remove from client
        client.nodeDestroyQueue.push(node); 
    }
}

GameServer.prototype.updateAll = function() {
    for (var i = 0; i < this.clients.length; i++) {
        if (typeof this.clients[i] == "undefined") {
            continue;
        }

        this.clients[i].playerTracker.update();
    }
}

GameServer.prototype.spawnFood = function() {
    for (var i = 0; i < this.config.foodSpawnAmount; i++) {
        if (this.currentFood < this.config.foodMaxAmount) {
            var f = new Entity.Food(this.getNextNodeId(), null, this.getRandomPosition(), this.config.foodMass);
            f.setColor(this.getRandomColor());
			
            this.addNode(f);
            this.currentFood++;
        }
    }    
}

GameServer.prototype.virusCheck = function() {
    // Checks if there are enough viruses on the map
    while (this.nodesVirus.length < this.config.virusMinAmount) {
        // Spawns a virus
        var v = new Entity.Virus(this.getNextNodeId(), null, this.getRandomPosition(), this.config.virusStartMass);
        v.setProt(2);
        this.addNode(v);
    }
}

GameServer.prototype.updateMoveEngine = function() {
	// Checks eating range every 500 ms
    var checkRange = false;
    if (this.currentTick <= 0) {
        checkRange = true;
        currentTick = 10;
    } else {
        currentTick--;
    }
    
    // Move player cells
    var len = this.nodesPlayer.length;
    for (var i = 0; i < len; i++) {
        var cell = this.nodesPlayer[i];
    		
        // Do not move cells that have collision turned off
        if ((!cell) || (cell.getCollision())){
            continue;
        }
    		
        var client = cell.owner;
        
        // If cell's owner is offline, remove this cell
        if (!client.getStatus()) {
            this.removeNode(cell);
            continue;
        }
        
        cell.calcMove(client.getMouseX(), client.getMouseY(), this);
            
        // Only check nearby cells every 500 ms
        if (!checkRange) {
            continue;
        }
        
        // Check if cells nearby
        var list = this.getCellsInRange(cell);
        for (var j = 0; j < list.length ; j++) {
            var check = list[j];
        	
            // Consume effect
            check.onConsume(cell,this);
            
            // Remove cell
            check.setKiller(cell);
            this.removeNode(check); 
        }
    }
	// A system to move cells not controlled by players (ex. viruses, ejected mass)
    len = this.movingNodes.length;
    for (var i = 0; i < len; i++) {
        var check = this.movingNodes[i];
    	
        // Recycle unused nodes
        while ((typeof check == "undefined") && (i < this.movingNodes.length)) {
            // Remove moving cells that are undefined
            this.movingNodes.splice(i, 1);
            check = movingNodes[i];
        } if (i >= this.movingNodes.length) {
            continue;
        }
        
        if (check.getMoveTicks() > 0) {
            // If the cell has enough move ticks, then move it
            check.calcMovePhys(this.border);
            if ((check.getType() == 3) && (this.nodesVirus.length < this.config.virusMaxAmount)) {
                // Check for viruses
                var v = this.getNearestVirus(check);
                if (v) { // Feeds the virus if it exists
                    v.feed(check,this);
                }
            }
        } else {
            // Set collision off
            check.setCollisionOff(false);
            // Remove cell from list
            var index = this.movingNodes.indexOf(check);
            if (index != -1) {
                this.movingNodes.splice(index, 1);
            }
        }
    }
}

GameServer.prototype.setAsMovingNode = function(node) {
	this.movingNodes.push(node);
}

GameServer.prototype.newCellVirused = function(client, parent, angle, mass, speed) {
    // Starting position
    var startPos = {
        x: parent.position.x, 
        y: parent.position.y
    };
	
	// Create cell
	newCell = new Entity.PlayerCell(this.getNextNodeId(), client, startPos, mass);
	newCell.setAngle(angle);
	newCell.setMoveEngineData(speed, 8);
	newCell.setRecombineTicks(this.config.playerRecombineTime);
	newCell.setCollisionOff(true); // Turn off collision
	
    // Add to moving cells list
    this.addNode(newCell);
    this.setAsMovingNode(newCell);
}

GameServer.prototype.shootVirus = function(parent) {
	var parentPos = {
        x: parent.position.x,
        y: parent.position.y,
	};
	
    var newVirus = new Entity.Virus(this.getNextNodeId(), null, parentPos, this.config.virusStartMass);
    newVirus.setAngle(parent.getAngle());
    newVirus.setMoveEngineData(200, 20);
	
    // Add to moving cells list
    this.addNode(newVirus);
    this.setAsMovingNode(newVirus);
}

GameServer.prototype.getCellsInRange = function(cell) {
    var list = new Array();
    var r = cell.getSize(); // Get cell radius (Cell size = radius)
	
    var topY = cell.position.y - r;
    var bottomY = cell.position.y + r;
	
    var leftX = cell.position.x - r;
    var rightX = cell.position.x + r;

    // Loop through all cells that are visible to the cell. There is probably a more efficient way of doing this but whatever
	var len = cell.owner.visibleNodes.length;
    for (var i = 0;i < len;i++) {
        var check = cell.owner.visibleNodes[i];
		
        if (typeof check === 'undefined') {
            continue;
        }
		
        // Can't eat itself
        if (cell.nodeId == check.nodeId) {
            continue;
        }
        
        // Can't eat cells that have collision turned off
        if ((cell.owner == check.owner) && (cell.getCollision())) {
            continue;
        }
        
        // AABB Collision
        if (!check.collisionCheck(bottomY,topY,rightX,leftX)) {
            continue;
        }

        // Cell type check - Cell must be bigger than this number times the mass of the cell being eaten
        var multiplier = 1.25;
		
        switch (check.getType()) {
            case 1: // Food cell
                list.push(check);
                continue;
            case 2: // Virus
                multiplier = 1.33;
                break;
            case 0: // Players
                multiplier = check.owner == cell.owner ? 1.00 : multiplier;
                // Can't eat team members
                if (this.gameMode.haveTeams) {
                    if (!check.owner) { // Error check
                        continue;
                    }
                	
                    if ((check.owner != cell.owner) && (check.owner.getTeam() == cell.owner.getTeam())) {
                        continue;
                    }
                }
                break;
            default: 
                break;
        }
        
        // Make sure the cell is big enough to be eaten.
        if ((check.mass * multiplier) > cell.mass) {
            continue;
        }
            	
        // Eating range
        var xs = Math.pow(check.position.x - cell.position.x, 2);
        var ys = Math.pow(check.position.y - cell.position.y, 2);
        var dist = Math.sqrt( xs + ys );
                
        var eatingRange = cell.getSize() - check.getEatingRange(); // Eating range = radius of eating cell + 1/3 of the radius of the cell being eaten
        if (dist > eatingRange) {
            // Not in eating range
            continue;
        }
		
        // Add to list of cells nearby
        list.push(check);
    }
    return list;
}

GameServer.prototype.getNearestVirus = function(cell) { 
	// More like getNearbyVirus
	var virus = null;
    var r = 100; // Checking radius
	
    var topY = cell.position.y - r;
    var bottomY = cell.position.y + r;
	
    var leftX = cell.position.x - r;
    var rightX = cell.position.x + r;

    // Loop through all viruses on the map. There is probably a more efficient way of doing this but whatever
	var len = this.nodesVirus.length;
    for (var i = 0;i < len;i++) {
        var check = this.nodesVirus[i];
		
        if (typeof check === 'undefined') {
            continue;
        }
		
        if (!check.collisionCheck(bottomY,topY,rightX,leftX)) {
            continue;
        }
        		
        // Add to list of cells nearby
        virus = check;
    }
    return virus;
}

GameServer.prototype.updateLeaderboard = function() {
    // Clear the leaderboard first
    this.leaderboard = []; 
    // Update leaderboard with the gamemode's method
    this.gameMode.updateLB(this);
}

GameServer.prototype.updateCells = function(){
    for (var i = 0; i < this.nodesPlayer.length; i++) {
        var cell = this.nodesPlayer[i];
        
        if (!cell) {
        	continue;
        }
        
        // Recombining
        if (cell.getRecombineTicks() > 0) {
            cell.setRecombineTicks(cell.getRecombineTicks() - 1);
        }
		
        // Mass decay
        if (cell.mass > this.config.playerMinMassDecay) {
            var decay = 0;
        	
            // Gamemode modifiers
            decay = decay * this.gameMode.decayMod;
        	
            cell.mass *= (1 - this.config.playerMassDecayRate);
        }
    }
    for (i in this.nodesVirus) {
        var v = this.nodesVirus[i];
        if (v.getProt() > 0) {
            v.decProt();
        }
    }
}

// Custom prototype functions
WebSocket.prototype.sendPacket = function(packet) {
    function getbuf(data) {
        var array = new Uint8Array(data.buffer || data);
        var l = data.byteLength || data.length;
        var o = data.byteOffset || 0;
        var buffer = new Buffer(l);

        for (var i = 0; i < l; i++) {
            buffer[i] = array[o + i];
        }

        return buffer;
    }

    if (this.readyState == WebSocket.OPEN && packet.build) {
        var buf = packet.build();
        this.send(getbuf(buf), { binary: true });
    }
}
