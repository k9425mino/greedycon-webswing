import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import {
  SOCKET_EVENTS,
  type ControllerStatus,
  type HostState,
  type InputFrame,
} from '../shared/types';
import { SessionStore, type Session } from './session';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serveStatic = process.argv.includes('--serve-static');
const port = Number(process.env.PORT ?? 5173);

async function main() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer);
  const sessions = new SessionStore();

  // "/controller" (슬래시 없음) 접속만 정적/미들웨어 처리가 되는 "/controller/"로 보낸다.
  // app.get은 strict routing이 꺼져 있어 "/controller/"도 매칭해버리므로 경로를 직접 비교한다.
  app.use((req, res, next) => {
    if (req.path === '/controller') {
      res.redirect(302, '/controller/');
      return;
    }
    next();
  });

  if (serveStatic) {
    app.use(express.static(path.join(__dirname, '../dist/client')));
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      configFile: path.join(__dirname, '../vite.config.ts'),
      root: path.join(__dirname, '../client'),
      // 터널(cloudflared) 주소로 접속하므로 Vite의 host 검사를 열어둔다.
      server: { middlewareMode: true, allowedHosts: true },
      appType: 'mpa',
    });
    app.use(vite.middlewares);
  }

  const socketIdToSessionId = new Map<string, string>();
  const socketIdToRole = new Map<string, 'host' | 'controller'>();

  function emitSessionStatus(session: Session) {
    const status = {
      hostConnected: session.hostSocketId !== null,
      controllerConnected: session.controllerSocketId !== null,
    };
    if (session.hostSocketId) io.to(session.hostSocketId).emit(SOCKET_EVENTS.sessionStatus, status);
    if (session.controllerSocketId)
      io.to(session.controllerSocketId).emit(SOCKET_EVENTS.sessionStatus, status);
  }

  io.on('connection', (socket) => {
    socket.on(SOCKET_EVENTS.sessionCreate, (_payload, ack) => {
      const session = sessions.create(socket.id);
      socketIdToSessionId.set(socket.id, session.id);
      socketIdToRole.set(socket.id, 'host');
      ack({
        ok: true,
        sessionId: session.id,
        hostToken: session.hostToken,
        inviteToken: session.inviteToken,
      });
    });

    socket.on(SOCKET_EVENTS.sessionJoin, (payload: { inviteToken?: string }, ack) => {
      const session = sessions.findByInviteToken(payload?.inviteToken ?? '');
      if (!session) {
        ack({ ok: false, error: 'invalid_invite' });
        return;
      }
      const result = sessions.joinController(session, socket.id);
      if (!result.ok) {
        ack({ ok: false, error: 'controller_busy' });
        return;
      }
      socketIdToSessionId.set(socket.id, session.id);
      socketIdToRole.set(socket.id, 'controller');
      ack({ ok: true, sessionId: session.id, controllerToken: session.controllerToken });
      emitSessionStatus(session);
    });

    socket.on(SOCKET_EVENTS.sessionResume, (payload: { token?: string }, ack) => {
      const token = payload?.token ?? '';
      const hostSession = sessions.findByHostToken(token);
      if (hostSession) {
        sessions.resumeHost(hostSession, socket.id);
        socketIdToSessionId.set(socket.id, hostSession.id);
        socketIdToRole.set(socket.id, 'host');
        ack({ ok: true, sessionId: hostSession.id, role: 'host' });
        emitSessionStatus(hostSession);
        return;
      }
      const controllerSession = sessions.findByControllerToken(token);
      if (controllerSession) {
        sessions.resumeController(controllerSession, socket.id);
        socketIdToSessionId.set(socket.id, controllerSession.id);
        socketIdToRole.set(socket.id, 'controller');
        ack({ ok: true, sessionId: controllerSession.id, role: 'controller' });
        emitSessionStatus(controllerSession);
        return;
      }
      ack({ ok: false, error: 'invalid_token' });
    });

    socket.on(SOCKET_EVENTS.sessionReplaceController, () => {
      const sessionId = socketIdToSessionId.get(socket.id);
      const session = sessionId ? sessions.getById(sessionId) : undefined;
      if (!session || session.hostSocketId !== socket.id) return;
      if (session.controllerSocketId) {
        io.sockets.sockets.get(session.controllerSocketId)?.disconnect(true);
      }
      sessions.replaceController(session);
      emitSessionStatus(session);
    });

    socket.on(SOCKET_EVENTS.controllerInput, (frame: InputFrame) => {
      const sessionId = socketIdToSessionId.get(socket.id);
      const session = sessionId ? sessions.getById(sessionId) : undefined;
      if (!session || session.hostSocketId === null) return;
      io.to(session.hostSocketId).emit(SOCKET_EVENTS.controllerInput, frame);
    });

    socket.on(SOCKET_EVENTS.controllerStatus, (status: ControllerStatus) => {
      const sessionId = socketIdToSessionId.get(socket.id);
      const session = sessionId ? sessions.getById(sessionId) : undefined;
      if (!session || session.hostSocketId === null) return;
      io.to(session.hostSocketId).emit(SOCKET_EVENTS.controllerStatus, status);
    });

    socket.on(SOCKET_EVENTS.hostState, (state: HostState) => {
      const sessionId = socketIdToSessionId.get(socket.id);
      const session = sessionId ? sessions.getById(sessionId) : undefined;
      if (!session || session.controllerSocketId === null) return;
      io.to(session.controllerSocketId).emit(SOCKET_EVENTS.hostState, state);
    });

    socket.on('disconnect', () => {
      const sessionId = socketIdToSessionId.get(socket.id);
      const role = socketIdToRole.get(socket.id);
      socketIdToSessionId.delete(socket.id);
      socketIdToRole.delete(socket.id);
      const session = sessionId ? sessions.getById(sessionId) : undefined;
      if (!session) return;
      if (role === 'host' && session.hostSocketId === socket.id) {
        sessions.disconnectHost(session);
      } else if (role === 'controller' && session.controllerSocketId === socket.id) {
        sessions.disconnectController(session);
      }
      emitSessionStatus(session);
    });
  });

  httpServer.listen(port, () => {
    console.log(`server listening on http://localhost:${port}`);
  });
}

main();
