import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { LandingPage } from './components/LandingPage';
import { CreateRoomModal } from './components/CreateRoomModal';
import { JoinRoomModal } from './components/JoinRoomModal';
import { RoomView } from './components/RoomView';
import { QRCodeModal } from './components/QRCodeModal';
import { ArchitectureModal } from './components/ArchitectureModal';
import { socketClient } from './lib/socketClient';
import { audioEngine } from './lib/audioEngine';
import { Room, AudioChannelRole, WSMessage } from './types';

export default function App() {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [currentRoom, setCurrentRoom] = useState<Room | null>(null);
  const [myClientId, setMyClientId] = useState<string>('');
  
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [isJoinModalOpen, setIsJoinModalOpen] = useState<boolean>(false);
  const [joinInitialCode, setJoinInitialCode] = useState<string>('');
  const [isQRModalOpen, setIsQRModalOpen] = useState<boolean>(false);
  const [isArchitectureModalOpen, setIsArchitectureModalOpen] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    socketClient.connect();

    // Parse ?room= CODE from URL if present
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam) {
      setJoinInitialCode(roomParam.toUpperCase());
      setIsJoinModalOpen(true);
    }

    const unsubscribe = socketClient.subscribe((msg: WSMessage) => {
      const { type, payload } = msg;

      if (type === 'ROOM_JOINED') {
        setMyClientId(payload.clientId);
      }

      if (type === 'ROOM_STATE_UPDATE') {
        setCurrentRoom(payload as Room);
        setErrorMessage(null);
      }

      if (type === 'ERROR') {
        setErrorMessage(payload.message || 'An error occurred.');
        setTimeout(() => setErrorMessage(null), 4000);
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const handleCreateRoomSubmit = (data: {
    roomName: string;
    userName: string;
    channelRole: AudioChannelRole;
    deviceType: string;
  }) => {
    // Must happen synchronously inside this click handler — browsers only allow
    // audio playback to start if it traces back to a real user gesture like this.
    audioEngine.initAudioContext();
    socketClient.send('CREATE_ROOM', data);
    setIsCreateModalOpen(false);
  };

  const handleJoinRoomSubmit = (data: {
    roomCode: string;
    userName: string;
    channelRole: AudioChannelRole;
    deviceType: string;
  }) => {
    audioEngine.initAudioContext();
    socketClient.send('JOIN_ROOM', data);
    setIsJoinModalOpen(false);
  };

  const handleOpenJoinWithCode = (code?: string) => {
    if (code) setJoinInitialCode(code);
    setIsJoinModalOpen(true);
  };

  const handleQuickDemo = () => {
    // Instant 1-Click Demo
    audioEngine.initAudioContext();
    socketClient.send('CREATE_ROOM', {
      roomName: 'Demo Spatial Array Room',
      userName: 'Main Phone (Host)',
      channelRole: 'full',
      deviceType: 'mobile'
    });
  };

  const handleLeaveRoom = () => {
    audioEngine.stopPlayback();
    socketClient.leaveRoom();
    setCurrentRoom(null);
    setMyClientId('');
    window.history.pushState({}, '', window.location.pathname);
  };

  return (
    <div className={`min-h-screen font-sans transition-colors ${
      isDarkMode ? 'bg-[#0b0b0c] text-white' : 'bg-zinc-50 text-zinc-900'
    }`}>
      
      {/* Top Navbar */}
      <Navbar
        currentRoomCode={currentRoom?.code || null}
        onOpenArchitecture={() => setIsArchitectureModalOpen(true)}
        isDarkMode={isDarkMode}
        onToggleTheme={() => setIsDarkMode(!isDarkMode)}
        participantCount={currentRoom ? Object.keys(currentRoom.participants).length : 0}
      />

      {/* Global error banner */}
      {errorMessage && (
        <div className="fixed top-[4.5rem] left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-rose-600 text-white text-xs font-medium shadow-lg">
          {errorMessage}
        </div>
      )}

      {/* Main View Switching */}
      {currentRoom ? (
        <RoomView
          room={currentRoom}
          myClientId={myClientId || socketClient.getMyClientId() || ''}
          onLeaveRoom={handleLeaveRoom}
          onOpenQRCode={() => setIsQRModalOpen(true)}
          isDarkMode={isDarkMode}
        />
      ) : (
        <LandingPage
          onCreateRoom={() => setIsCreateModalOpen(true)}
          onJoinRoom={handleOpenJoinWithCode}
          onQuickDemo={handleQuickDemo}
          isDarkMode={isDarkMode}
        />
      )}

      {/* Modals */}
      <CreateRoomModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSubmit={handleCreateRoomSubmit}
        isDarkMode={isDarkMode}
      />

      <JoinRoomModal
        isOpen={isJoinModalOpen}
        initialCode={joinInitialCode}
        onClose={() => setIsJoinModalOpen(false)}
        onSubmit={handleJoinRoomSubmit}
        isDarkMode={isDarkMode}
      />

      <QRCodeModal
        isOpen={isQRModalOpen}
        onClose={() => setIsQRModalOpen(false)}
        roomCode={currentRoom?.code || ''}
        isDarkMode={isDarkMode}
      />

      <ArchitectureModal
        isOpen={isArchitectureModalOpen}
        onClose={() => setIsArchitectureModalOpen(false)}
        isDarkMode={isDarkMode}
      />

    </div>
  );
}
