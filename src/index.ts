import { WebSocketServer, WebSocket } from "ws";

const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: Number(PORT) });

interface User {
  socket: WebSocket;
  room: string;
  username: string;
}

interface Room {
  id: string;
  users: User[];
}

interface ChatMessage {
  text: string;
  sender: string;
  timestamp: number;
}

let allSockets: User[] = [];
let rooms: Room[] = [];

// Handle client disconnection and cleanup
const removeUser = (socket: WebSocket) => {
  const userIndex = allSockets.findIndex(user => user.socket === socket);
  if (userIndex !== -1) {
    const user = allSockets[userIndex];
    const room = rooms.find(r => r.id === user.room);
    if (room) {
      room.users = room.users.filter(u => u.socket !== socket);
      // Remove room if empty
      if (room.users.length === 0) {
        rooms = rooms.filter(r => r.id !== room.id);
      }
    }
    allSockets.splice(userIndex, 1);
  }
};

wss.on("connection", (socket) => {
  console.log("New client connected");

  socket.on("close", () => {
    console.log("Client disconnected");
    removeUser(socket);
  });

  socket.on("message", (message) => {
    try {
      const parsedMessage = JSON.parse(message.toString());
      
      if (parsedMessage.type === "create") {
        const roomId = parsedMessage.payload.roomId;
        const username = parsedMessage.payload.username;
        const newRoom: Room = {
          id: roomId,
          users: []
        };
        rooms.push(newRoom);
        
        const newUser: User = {
          socket,
          room: roomId,
          username
        };
        allSockets.push(newUser);
        newRoom.users.push(newUser);
        
        socket.send(JSON.stringify({
          type: "roomCreated",
          payload: { roomId }
        }));
      }

      if (parsedMessage.type === "join") {
        const roomId = parsedMessage.payload.roomId;
        const username = parsedMessage.payload.username;
        const room = rooms.find(r => r.id === roomId);
        
        if (!room) {
          socket.send(JSON.stringify({
            type: "error",
            payload: { message: "Room not found" }
          }));
          return;
        }

        const newUser: User = {
          socket,
          room: roomId,
          username
        };
        
        allSockets.push(newUser);
        room.users.push(newUser);
        
        socket.send(JSON.stringify({
          type: "joined",
          payload: { roomId }
        }));

        // Notify other users in the room
        room.users.forEach(user => {
          if (user.socket !== socket) {
            user.socket.send(JSON.stringify({
              type: "userJoined",
              payload: { username }
            }));
          }
        });
      }

      if (parsedMessage.type === "chat") {
        const currentUser = allSockets.find(user => user.socket === socket);
        if (currentUser && currentUser.room) {
          const room = rooms.find(r => r.id === currentUser.room);
          if (room) {
            const chatMessage: ChatMessage = {
              text: parsedMessage.payload.message,
              sender: currentUser.username,
              timestamp: Date.now()
            };
            
            room.users.forEach(user => {
              user.socket.send(JSON.stringify({
                type: "chat",
                payload: chatMessage
              }));
            });
          }
        }
      }
    } catch (error) {
      console.error("Error processing message:", error);
      socket.send(JSON.stringify({
        type: "error",
        payload: { message: "Invalid message format" }
      }));
    }
  });
});

// Log server start
console.log(`WebSocket server is running on port ${PORT}`);
