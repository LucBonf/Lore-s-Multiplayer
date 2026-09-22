/**
 * LORES / LUCAS GAME - VOICE CHAT ENGINE (WebRTC P2P Mesh)
 * Comunicazione vocale cifrata browser-to-browser.
 * Zero registrazione, zero archiviazione server, codec Opus ad alta fedeltà.
 */

const ICE_SERVERS = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
    ]
};

class VoiceChatManager {
    constructor() {
        this.socket = null;
        this.localStream = null;
        this.peers = new Map(); // peerId -> { pc, audio, analyser, dataArray }
        this.isEnabled = false;
        this.isMuted = false;
        this.audioCtx = null;
        this.localAnalyser = null;
        this.vadInterval = null;
        this.lastSpeakingState = false;
        this.speakingThrottle = 0;

        // Callback per notificare l'interfaccia
        this.onStateChange = null;
        this.onSpeakingChange = null;
    }

    isSupported() {
        return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.RTCPeerConnection);
    }

    init(socket) {
        if (this.socket) return;
        this.socket = socket;
        this._setupSocketListeners();
    }

    _setupSocketListeners() {
        if (!this.socket) return;

        // Riceviamo la lista dei peer già presenti nella voice room
        this.socket.on('voice_peers_list', async (peerIds) => {
            if (!this.isEnabled || !this.localStream) return;
            for (const peerId of peerIds) {
                // Essendo noi i nuovi arrivati, creiamo l'offerta per ciascun peer
                await this._createPeerConnection(peerId, true);
            }
        });

        // Un nuovo peer si è connesso: chi era già nella stanza aspetta l'offerta dal nuovo arrivato
        this.socket.on('voice_peer_joined', async ({ peerId }) => {
            if (!this.isEnabled || !this.localStream) return;
        });

        // Segnali WebRTC in arrivo (offer, answer, candidate)
        this.socket.on('voice_signal', async ({ from, signal }) => {
            if (!this.isEnabled || !this.localStream) return;
            await this._handleSignal(from, signal);
        });

        // Stato muto/speaking di un peer remoto
        this.socket.on('voice_peer_state', ({ peerId, isMuted, isSpeaking }) => {
            if (this.onSpeakingChange) {
                this.onSpeakingChange(peerId, isSpeaking && !isMuted);
            }
        });

        // Un peer ha lasciato la chat vocale
        this.socket.on('voice_peer_left', ({ peerId }) => {
            this._removePeer(peerId);
        });
    }

    async toggleVoice() {
        if (this.isEnabled) {
            this.leaveVoice();
            return false;
        } else {
            return await this.startVoice();
        }
    }

    async startVoice() {
        if (!this.isSupported()) {
            alert("Il tuo browser non supporta WebRTC per la chat vocale.");
            return false;
        }

        try {
            // Richiesta accesso al microfono con ottimizzazioni per la voce
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                },
                video: false
            });

            this.isEnabled = true;
            this.isMuted = false;

            // Inizializza l'analizzatore di volume locale per la Voice Activity Detection (VAD)
            this._initLocalAnalyser();

            // Notifichiamo al server l'ingresso nella voice room
            if (this.socket) {
                this.socket.emit('voice_join');
            }

            this._notifyState();
            return true;
        } catch (err) {
            console.error("Accesso microfono negato o non disponibile:", err);
            this.leaveVoice();
            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                alert("Permesso microfono non concesso. Abilita il microfono nelle impostazioni del browser per usare la chat vocale.");
            } else {
                alert("Impossibile accedere al microfono: " + err.message);
            }
            return false;
        }
    }

    toggleMute() {
        if (!this.isEnabled || !this.localStream) return;
        this.isMuted = !this.isMuted;
        this.localStream.getAudioTracks().forEach(track => {
            track.enabled = !this.isMuted;
        });

        if (this.socket) {
            this.socket.emit('voice_state', { isMuted: this.isMuted, isSpeaking: false });
        }

        if (this.onSpeakingChange) {
            this.onSpeakingChange('me', false);
        }

        this._notifyState();
        return this.isMuted;
    }

    leaveVoice() {
        // Ferma i track locali
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }

        // Chiude tutte le connessioni peer
        for (const peerId of Array.from(this.peers.keys())) {
            this._removePeer(peerId);
        }

        // Ferma l'analizzatore VAD
        if (this.vadInterval) {
            clearInterval(this.vadInterval);
            this.vadInterval = null;
        }

        if (this.audioCtx && this.audioCtx.state !== 'closed') {
            try { this.audioCtx.close(); } catch (e) {}
            this.audioCtx = null;
        }

        if (this.socket && this.isEnabled) {
            this.socket.emit('voice_leave');
        }

        this.isEnabled = false;
        this.isMuted = false;

        if (this.onSpeakingChange) {
            this.onSpeakingChange('me', false);
        }

        this._notifyState();
    }

    async _createPeerConnection(peerId, isInitiator) {
        if (this.peers.has(peerId)) {
            return this.peers.get(peerId).pc;
        }

        const pc = new RTCPeerConnection(ICE_SERVERS);
        const peerData = { pc, audio: null, analyser: null, dataArray: null };
        this.peers.set(peerId, peerData);

        // Aggiungiamo i track locali al peer
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                pc.addTrack(track, this.localStream);
            });
        }

        // Invio dei candidati ICE al peer remoto tramite signaling
        pc.onicecandidate = (event) => {
            if (event.candidate && this.socket) {
                this.socket.emit('voice_signal', {
                    to: peerId,
                    signal: { candidate: event.candidate }
                });
            }
        };

        // Ricezione dello stream audio remoto
        pc.ontrack = (event) => {
            const remoteStream = event.streams[0];
            let audioEl = peerData.audio;
            if (!audioEl) {
                audioEl = document.createElement('audio');
                audioEl.autoplay = true;
                audioEl.playsInline = true;
                audioEl.volume = 1.0;
                document.body.appendChild(audioEl);
                peerData.audio = audioEl;
            }
            audioEl.srcObject = remoteStream;

            // Collega l'analizzatore audio per monitorare chi parla
            this._attachRemoteAnalyser(peerId, remoteStream);
        };

        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
                this._removePeer(peerId);
            }
        };

        // Se siamo l'iniziatore, creiamo e inviamo l'offerta SDP
        if (isInitiator) {
            try {
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                if (this.socket) {
                    this.socket.emit('voice_signal', {
                        to: peerId,
                        signal: { sdp: pc.localDescription }
                    });
                }
            } catch (err) {
                console.error("Errore creazione offerta SDP per", peerId, err);
            }
        }

        return pc;
    }

    async _handleSignal(peerId, signal) {
        let pc = this.peers.get(peerId)?.pc;

        if (signal.sdp) {
            const sdp = signal.sdp;
            if (sdp.type === 'offer') {
                if (!pc) {
                    pc = await this._createPeerConnection(peerId, false);
                }
                await pc.setRemoteDescription(new RTCSessionDescription(sdp));
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                if (this.socket) {
                    this.socket.emit('voice_signal', {
                        to: peerId,
                        signal: { sdp: pc.localDescription }
                    });
                }
            } else if (sdp.type === 'answer') {
                if (pc) {
                    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
                }
            }
        } else if (signal.candidate) {
            if (pc) {
                try {
                    await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
                } catch (e) {
                    console.error("Errore aggiunta ICE candidate:", e);
                }
            }
        }
    }

    _removePeer(peerId) {
        const peerData = this.peers.get(peerId);
        if (!peerData) return;

        try {
            if (peerData.pc) {
                peerData.pc.close();
            }
            if (peerData.audio) {
                peerData.audio.pause();
                peerData.audio.srcObject = null;
                peerData.audio.remove();
            }
        } catch (e) {}

        this.peers.delete(peerId);

        if (this.onSpeakingChange) {
            this.onSpeakingChange(peerId, false);
        }
    }

    _initLocalAnalyser() {
        if (!this.localStream) return;
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return;
            if (!this.audioCtx) this.audioCtx = new AudioCtx();

            const source = this.audioCtx.createMediaStreamSource(this.localStream);
            this.localAnalyser = this.audioCtx.createAnalyser();
            this.localAnalyser.fftSize = 256;
            source.connect(this.localAnalyser);

            this.localDataArray = new Uint8Array(this.localAnalyser.frequencyBinCount);

            // Avvia il loop di rilevamento attività vocale (VAD)
            if (!this.vadInterval) {
                this.vadInterval = setInterval(() => this._checkVoiceActivity(), 100);
            }
        } catch (e) {
            console.warn("Impossibile avviare analizzatore vocale locale:", e);
        }
    }

    _attachRemoteAnalyser(peerId, stream) {
        try {
            if (!this.audioCtx) {
                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                if (AudioCtx) this.audioCtx = new AudioCtx();
            }
            if (!this.audioCtx) return;

            const peerData = this.peers.get(peerId);
            if (!peerData) return;

            const source = this.audioCtx.createMediaStreamSource(stream);
            const analyser = this.audioCtx.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);

            peerData.analyser = analyser;
            peerData.dataArray = new Uint8Array(analyser.frequencyBinCount);
        } catch (e) {
            console.warn("Impossibile collegare analizzatore remoto:", e);
        }
    }

    _checkVoiceActivity() {
        const now = Date.now();

        // 1. Controllo locale (me)
        if (this.localAnalyser && this.localDataArray && !this.isMuted && this.isEnabled) {
            this.localAnalyser.getByteFrequencyData(this.localDataArray);
            let sum = 0;
            for (let i = 0; i < this.localDataArray.length; i++) {
                sum += this.localDataArray[i];
            }
            const average = sum / this.localDataArray.length;
            const isSpeaking = average > 14; // Soglia sensibilità microfono

            if (isSpeaking !== this.lastSpeakingState) {
                this.lastSpeakingState = isSpeaking;
                if (this.onSpeakingChange) {
                    this.onSpeakingChange('me', isSpeaking);
                }
                // Notifichiamo agli altri peer con throttling
                if (now - this.speakingThrottle > 250 && this.socket) {
                    this.speakingThrottle = now;
                    this.socket.emit('voice_state', { isMuted: false, isSpeaking: isSpeaking });
                }
            }
        }

        // 2. Controllo peer remoti
        for (const [peerId, peerData] of this.peers.entries()) {
            if (peerData.analyser && peerData.dataArray) {
                peerData.analyser.getByteFrequencyData(peerData.dataArray);
                let sum = 0;
                for (let i = 0; i < peerData.dataArray.length; i++) {
                    sum += peerData.dataArray[i];
                }
                const average = sum / peerData.dataArray.length;
                const isSpeaking = average > 14;
                if (this.onSpeakingChange) {
                    this.onSpeakingChange(peerId, isSpeaking);
                }
            }
        }
    }

    _notifyState() {
        if (this.onStateChange) {
            this.onStateChange({
                isEnabled: this.isEnabled,
                isMuted: this.isMuted,
                peersCount: this.peers.size
            });
        }
    }
}

// Istanza singleton esportata
const voiceManager = new VoiceChatManager();
export default voiceManager;
