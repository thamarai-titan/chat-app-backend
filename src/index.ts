import http from "http";
import { WebSocketServer, WebSocket } from "ws";

const PORT = process.env.PORT || 8080;

interface ExtWebSocket extends WebSocket {
  isAlive: boolean;
}

interface User {
  socket: ExtWebSocket;
  room: string;
  username: string;
}

export interface ChatMessage {
  id: string;
  text: string;
  sender: string;
  timestamp: number;
}

interface Room {
  id: string;
  users: User[];
  history: ChatMessage[];
}

let allSockets: User[] = [];
let rooms: Room[] = [];

// HTTP server for health checks (prevents Render cold-starts & allows ping services)
const server = http.createServer((req, res) => {
  // Enable CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === "/health" || req.url === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
        activeRooms: rooms.length,
        activeUsers: allSockets.length,
      })
    );
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not Found" }));
});

const wss = new WebSocketServer({ server });

// Cleanly broadcast user list & left event on exit
const removeUser = (socket: ExtWebSocket) => {
  const userIndex = allSockets.findIndex((user) => user.socket === socket);
  if (userIndex !== -1) {
    const user = allSockets[userIndex];
    const room = rooms.find((r) => r.id === user.room);
    
    if (room) {
      // Remove socket from room
      room.users = room.users.filter((u) => u.socket !== socket);

      // Notify remaining members
      const activeUsernames = room.users.map((u) => u.username);
      room.users.forEach((u) => {
        if (u.socket.readyState === WebSocket.OPEN) {
          u.socket.send(
            JSON.stringify({
              type: "userLeft",
              payload: { username: user.username },
            })
          );
          u.socket.send(
            JSON.stringify({
              type: "roomUsers",
              payload: { users: activeUsernames },
            })
          );
        }
      });

      // Remove room if empty
      if (room.users.length === 0) {
        rooms = rooms.filter((r) => r.id !== room.id);
      }
    }
    allSockets.splice(userIndex, 1);
  }
};

// 30s Heartbeat Ping/Pong to purge dead/zombie sockets
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((client) => {
    const extSocket = client as ExtWebSocket;
    if (extSocket.isAlive === false) {
      console.log("Terminating unresponsive zombie socket");
      removeUser(extSocket);
      return extSocket.terminate();
    }
    extSocket.isAlive = false;
    extSocket.ping();
  });
}, 30000);

wss.on("close", () => {
  clearInterval(heartbeatInterval);
});

wss.on("connection", (rawSocket) => {
  const socket = rawSocket as ExtWebSocket;
  socket.isAlive = true;

  socket.on("pong", () => {
    socket.isAlive = true;
  });

  console.log("New client connected. Total clients:", wss.clients.size);

  socket.on("close", () => {
    console.log("Client disconnected");
    removeUser(socket);
  });

  socket.on("error", (err) => {
    console.error("Socket error:", err);
    removeUser(socket);
  });

  socket.on("message", (message) => {
    try {
      const parsedMessage = JSON.parse(message.toString());
      const { type, payload } = parsedMessage;

      if (type === "create") {
        const roomId = payload?.roomId?.trim();
        const username = payload?.username?.trim();

        if (!roomId || !username) {
          socket.send(
            JSON.stringify({
              type: "error",
              payload: { message: "Room ID and username are required." },
            })
          );
          return;
        }

        let room = rooms.find((r) => r.id === roomId);
        if (!room) {
          room = {
            id: roomId,
            users: [],
            history: [],
          };
          rooms.push(room);
        }

        const newUser: User = { socket, room: roomId, username };
        allSockets.push(newUser);
        room.users.push(newUser);

        const currentUsers = room.users.map((u) => u.username);

        socket.send(
          JSON.stringify({
            type: "roomCreated",
            payload: {
              roomId,
              username,
              users: currentUsers,
              history: room.history,
            },
          })
        );

        // Broadcast to all users in room
        room.users.forEach((u) => {
          if (u.socket.readyState === WebSocket.OPEN) {
            u.socket.send(
              JSON.stringify({
                type: "roomUsers",
                payload: { users: currentUsers },
              })
            );
          }
        });
      }

      if (type === "join") {
        const roomId = payload?.roomId?.trim();
        const username = payload?.username?.trim();

        if (!roomId || !username) {
          socket.send(
            JSON.stringify({
              type: "error",
              payload: { message: "Room ID and username are required." },
            })
          );
          return;
        }

        const room = rooms.find((r) => r.id === roomId);
        if (!room) {
          socket.send(
            JSON.stringify({
              type: "error",
              payload: { message: `Room "${roomId}" was not found. Please verify the ID or create a new room.` },
            })
          );
          return;
        }

        const newUser: User = { socket, room: roomId, username };
        allSockets.push(newUser);
        room.users.push(newUser);

        const currentUsers = room.users.map((u) => u.username);

        // Send confirmation and chat history to the newly joined user
        socket.send(
          JSON.stringify({
            type: "joined",
            payload: {
              roomId,
              username,
              users: currentUsers,
              history: room.history,
            },
          })
        );

        // Broadcast to all other users in the room
        room.users.forEach((u) => {
          if (u.socket.readyState === WebSocket.OPEN) {
            if (u.socket !== socket) {
              u.socket.send(
                JSON.stringify({
                  type: "userJoined",
                  payload: { username },
                })
              );
            }
            u.socket.send(
              JSON.stringify({
                type: "roomUsers",
                payload: { users: currentUsers },
              })
            );
          }
        });
      }

      if (type === "chat") {
        const text = payload?.message?.trim();
        if (!text) return;

        const currentUser = allSockets.find((u) => u.socket === socket);
        if (currentUser && currentUser.room) {
          const room = rooms.find((r) => r.id === currentUser.room);
          if (room) {
            const chatMessage: ChatMessage = {
              id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
              text,
              sender: currentUser.username,
              timestamp: Date.now(),
            };

            // Keep last 50 messages
            room.history.push(chatMessage);
            if (room.history.length > 50) {
              room.history.shift();
            }

            room.users.forEach((u) => {
              if (u.socket.readyState === WebSocket.OPEN) {
                u.socket.send(
                  JSON.stringify({
                    type: "chat",
                    payload: chatMessage,
                  })
                );
              }
            });
          }
        }
      }

      if (type === "typing") {
        const isTyping = Boolean(payload?.isTyping);
        const currentUser = allSockets.find((u) => u.socket === socket);
        if (currentUser && currentUser.room) {
          const room = rooms.find((r) => r.id === currentUser.room);
          if (room) {
            room.users.forEach((u) => {
              if (u.socket !== socket && u.socket.readyState === WebSocket.OPEN) {
                u.socket.send(
                  JSON.stringify({
                    type: "typing",
                    payload: {
                      username: currentUser.username,
                      isTyping,
                    },
                  })
                );
              }
            });
          }
        }
      }

      if (type === "leave") {
        removeUser(socket);
        socket.send(
          JSON.stringify({
            type: "leftRoom",
          })
        );
      }
    } catch (error) {
      console.error("Error processing message:", error);
      socket.send(
        JSON.stringify({
          type: "error",
          payload: { message: "Invalid message format received." },
        })
      );
    }
  });
});

server.listen(Number(PORT), () => {
  console.log(`HTTP and WebSocket server running on port ${PORT}`);
});
