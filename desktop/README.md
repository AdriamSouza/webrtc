# Módulo Desktop Nativo (Fases 6 & 7 — Evolução de Alto Desempenho)

Este módulo representa a evolução da versão web para um cliente Desktop nativo em ambiente Windows, conforme detalhado nas **Seções 3.B, 4, 11, 12, 13 e 14** da arquitetura do sistema.

## Objetivo
Eliminar o gargalo de cópia de memória entre CPU e RAM do sistema operacional:
```
Pipeline Otimizado Zero-Copy (GPU Direct):
Windows Graphics Capture / Desktop Duplication 
   ↓
Textura na VRAM (Memória de Vídeo GPU)
   ↓
Hardware Encoder Dedicado (NVENC / AMF / QSV)
   ↓
WebRTC Criptografia SRTP / RTP
   ↓
Espectador P2P
```

## Tecnologias e Encoders por Fabricante
1. **NVIDIA (NVENC):** Codificador por hardware dedicado em placas GeForce/RTX.
2. **AMD (AMF - Advanced Media Framework):** Framework oficial da AMD para streaming de vídeo com aceleração por hardware (esclarecendo que ROCm não é encoder de vídeo, mas sim plataforma de computação GPGPU).
3. **Intel (Quick Sync Video - QSV):** Codificação dedicada em processadores Intel Core e GPUs dedicadas Intel Arc.
4. **Software Fallback:** Encoder baseado em CPU (como x264 / openh264) acionado dinamicamente caso nenhuma GPU dedicada esteja disponível.

## Codecs
- **AV1 (AOMedia Video 1):** Alta taxa de compressão para renderização nítida de textos e jogos a 60 FPS com bitrate controlado.
- **H.264 (AVC):** Fallback universal para compatibilidade ampla.
