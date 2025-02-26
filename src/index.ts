import { WebSocketServer , WebSocket } from "ws";
const wss = new WebSocketServer({ port: 8080 });
interface User {
  socket:WebSocket;
  room:string;
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

let allSockets:User[] = [];
let rooms: Room[] = [];

wss.on("connection", (socket) => {

  socket.on("message",(message)=>{
    // @ts-ignore
    const parsedMessage = JSON.parse(message)
    
    if(parsedMessage.type === "create") {
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

    if(parsedMessage.type === "join"){
      const roomId = parsedMessage.payload.roomId;
      const username = parsedMessage.payload.username;
      const room = rooms.find(r => r.id === roomId);
      
      if(!room) {
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
    }

    if(parsedMessage.type === "chat"){
      const currentUser = allSockets.find(user => user.socket === socket);
      if (currentUser && currentUser.room) {
        const room = rooms.find(r => r.id === currentUser.room);
        if(room) {
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
  })
  
});