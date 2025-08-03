// src/index.ts
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();
app.use(cors()); // Enable CORS for all routes

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Allow all origins for simplicity. For production, restrict this to your Next.js app's URL.
    methods: ["GET", "POST"],
  },
});

// A queue of users waiting to be matched
let waitingQueue: string[] = [];
// A map to store peer connections: { socketId: peerSocketId }
let peers: Map<string, string> = new Map();

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // --- Matchmaking Logic ---
  if (waitingQueue.length > 0) {
    // If there's someone waiting, pair them up
    const peerSocketId = waitingQueue.shift()!; // Pop the first user from the queue
    
    // Store the peer connection
    peers.set(socket.id, peerSocketId);
    peers.set(peerSocketId, socket.id);

    console.log(`Match found: ${socket.id} and ${peerSocketId}`);

    // Notify both users that a match has been found
    // The first user (from queue) will be the initiator
    io.to(peerSocketId).emit('match-found', { 
      peerSocketId: socket.id, 
      isInitiator: true 
    });
    io.to(socket.id).emit('match-found', { 
      peerSocketId: peerSocketId, 
      isInitiator: false 
    });
  } else {
    // If no one is waiting, add this user to the queue
    waitingQueue.push(socket.id);
    console.log(`User ${socket.id} added to the waiting queue`);
  }
  
  // --- WebRTC Signaling Handler ---
  // Relays WebRTC signals (offer, answer, ICE candidates) to the peer
  socket.on('signal', (payload) => {
    const peerSocketId = peers.get(socket.id);
    if (peerSocketId) {
      console.log(`Relaying signal from ${socket.id} to ${peerSocketId}:`, Object.keys(payload));
      io.to(peerSocketId).emit('signal', payload);
    } else {
      console.log(`No peer found for socket ${socket.id}`);
    }
  });

  // --- Find Next Peer Handler ---
  socket.on('find-next', () => {
    console.log(`User ${socket.id} looking for next peer`);
    handleDisconnect(socket.id);
    
    // Re-add the user to matchmaking
    if (waitingQueue.length > 0) {
      const peerSocketId = waitingQueue.shift()!;
      peers.set(socket.id, peerSocketId);
      peers.set(peerSocketId, socket.id);
      
      console.log(`New match found: ${socket.id} and ${peerSocketId}`);
      
      // The user from queue becomes the initiator
      io.to(peerSocketId).emit('match-found', { 
        peerSocketId: socket.id, 
        isInitiator: true 
      });
      io.to(socket.id).emit('match-found', { 
        peerSocketId: peerSocketId, 
        isInitiator: false 
      });
    } else {
      waitingQueue.push(socket.id);
      console.log(`User ${socket.id} added back to waiting queue`);
    }
  });

  // --- Disconnect Handler ---
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    handleDisconnect(socket.id);
  });
});

const handleDisconnect = (socketId: string) => {
  const peerSocketId = peers.get(socketId);
  
  // If the user was in a pair
  if (peerSocketId) {
    console.log(`Notifying ${peerSocketId} that ${socketId} disconnected`);
    // Notify the other peer
    io.to(peerSocketId).emit('peer-disconnected');
    // Remove the pair from the map
    peers.delete(peerSocketId);
    peers.delete(socketId);
  } else {
    // If the user was in the waiting queue, remove them
    const queueIndex = waitingQueue.indexOf(socketId);
    if (queueIndex > -1) {
      waitingQueue.splice(queueIndex, 1);
      console.log(`Removed ${socketId} from waiting queue`);
    }
  }
};

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`🚀 Signaling server is running on http://localhost:${PORT}`);
});