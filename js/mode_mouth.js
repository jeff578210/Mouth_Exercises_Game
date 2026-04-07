// js/mode_mouth.js
import { FaceLandmarker, FilesetResolver } from "https://cdn.skypack.dev/@mediapipe/tasks-vision@0.10.3";
import * as THREE from 'three'; 
import { currentVrm, currentTrainingMode, isGameRunning, currentDifficulty, DIFFICULTY_CONFIG, poseQueue, isTutorialLocked, triggerResult } from './app.js';

let faceLandmarker;
let video;
let isDetecting = false;
let lastVideoTime = -1;

// 遊戲狀態控制
let holdTime = 0;
let turnTimeLeft = 5000;
let lastTarget = "";
let lastTime = performance.now();

// 麥克風音量偵測
let smoothedVolume = 0;
export let audioContext;
export let analyser;
export let dataArray;
export let isMicEnabled = false;

// 🌟 語音辨識系統 (開放給發聲模式去暫停它)
export let recognitionMouth = null;
export let latestSpokenWord = ""; 

const MOUTH_SOUND_MAP = {
    "ㄚ": ["啊", "阿", "a", "ㄚ", "哈", "哇", "拉", "他", "帕", "答"],
    "ㄧ": ["一", "伊", "衣", "i", "e", "ㄧ", "以", "滴", "踢", "七", "西", "吉"],
    "ㄨ": ["屋", "嗚", "無", "五", "u", "wu", "ㄨ", "物", "呼", "不", "出", "苦"],
    "ㄟ": ["欸", "黑", "A", "ei", "ㄟ", "诶", "飛", "倍", "給", "美", "內"],
    "ㄛ": ["喔", "哦", "o", "ou", "ㄛ", "我", "波", "破", "多", "佛"]
};

export function resumeAudio() {
    if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume().then(() => console.log("🔊 音訊系統已成功喚醒！"));
    }
}

// 初始化 MediaPipe 與攝影機、麥克風、語音辨識
export async function initMouthMode() {
    console.log("正在載入 MediaPipe 臉部追蹤與語音辨識模組...");
    const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm");
    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
            delegate: "GPU"
        },
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true, 
        runningMode: "VIDEO",
        numFaces: 1
    });
    
    video = document.getElementById("video"); 
    if (!video) {
        video = document.createElement('video');
        video.id = 'video';
        video.autoplay = true;
        video.playsInline = true;
        video.style.display = 'none';
        document.body.appendChild(video);
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        video.srcObject = stream;
        video.play(); 
        
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);
        analyser.fftSize = 256;
        dataArray = new Uint8Array(analyser.frequencyBinCount);
        isMicEnabled = true;

    } catch (err) {
        console.error("無法取得攝影機或麥克風權限", err);
        isMicEnabled = false;
    }

    // 🎤 初始化語音辨識
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
        recognitionMouth = new SpeechRecognition();
        recognitionMouth.continuous = true;
        recognitionMouth.interimResults = true;
        recognitionMouth.lang = 'zh-TW';

        recognitionMouth.onresult = (event) => {
            if (!isDetecting || currentTrainingMode !== 'mouth' || !isGameRunning) return;
            let currentTranscript = "";
            for (let i = event.resultIndex; i < event.results.length; i++) {
                currentTranscript += event.results[i][0].transcript.toLowerCase();
            }
            latestSpokenWord = currentTranscript; 
            console.log(`[嘴型模式-收音] 聽到: "${latestSpokenWord}"`);
        };

        recognitionMouth.onend = () => {
            if (isDetecting && currentTrainingMode === 'mouth') {
                try { recognitionMouth.start(); } catch(e){}
            }
        };
    }

    console.log("✅ 嘴型模式初始化完成");
}

export function startMouthDetection() {
    if (isDetecting) return;
    isDetecting = true;
    lastTime = performance.now();
    latestSpokenWord = ""; 
    
    if (recognitionMouth) {
        try { recognitionMouth.stop(); } catch(e){}
        setTimeout(() => { try { recognitionMouth.start(); } catch(e){} }, 100);
    }
    predictLoop();
}

export function stopMouthDetection() {
    lastTarget = ""; 
    if (recognitionMouth) { try { recognitionMouth.stop(); } catch(e){} }
}

export function setMicStatus(status) {
    isMicEnabled = status;
    const micBtn = document.getElementById("toggleMicBtn");
    if (micBtn) {
        if (status) {
            micBtn.innerText = '🎙️ 語音判定：開啟';
            micBtn.classList.remove('off');
        } else {
            micBtn.innerText = '🎙️ 語音判定：關閉';
            micBtn.classList.add('off');
        }
    }
    if (!status && analyser) {
        smoothedVolume = 0;
        const meterFill = document.getElementById("meter-fill");
        if (meterFill) meterFill.style.width = "0%";
    }
}

// AI 辨識與遊戲邏輯迴圈
async function predictLoop() {
    if (!isDetecting) return;

    let currentTime = performance.now();
    let dt = currentTime - lastTime;
    lastTime = currentTime;

    // 1. 全域音量計算與 UI
    if (isMicEnabled && analyser) {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
        smoothedVolume = smoothedVolume * 0.8 + (sum / dataArray.length) * 0.2;

        const meterFill = document.getElementById("meter-fill");
        if (meterFill && currentDifficulty !== "easy" && currentTrainingMode === 'mouth') {
            meterFill.style.width = Math.min((smoothedVolume / 80) * 100, 100) + "%";
            meterFill.style.backgroundColor = "#3498db";
        }
    }

    if (video && video.readyState >= 2 && faceLandmarker) {
        if (lastVideoTime !== video.currentTime) {
            lastVideoTime = video.currentTime;
            const results = faceLandmarker.detectForVideo(video, performance.now());

            // =========================================
            // 🌟 第一階段：物理連動 (維持你原本的完美設計)
            // =========================================
            let jawOpen = 0, mouthPucker = 0, mouthStretch = 0, mouthSmile = 0, mouthFunnel = 0;

            if (results.faceBlendshapes && results.faceBlendshapes.length > 0) {
                const shapes = results.faceBlendshapes[0].categories;
                jawOpen = shapes.find(s => s.categoryName === "jawOpen")?.score || 0;
                mouthPucker = shapes.find(s => s.categoryName === "mouthPucker")?.score || 0;
                mouthStretch = shapes.find(s => s.categoryName === "mouthStretchLeft")?.score || 0;
                mouthSmile = shapes.find(s => s.categoryName === "mouthSmileLeft")?.score || 0;
                mouthFunnel = shapes.find(s => s.categoryName === "mouthFunnel")?.score || 0;

                if (currentVrm) {
                    currentVrm.expressionManager.setValue('aa', jawOpen);
                    currentVrm.expressionManager.setValue('ou', mouthPucker);
                    currentVrm.expressionManager.setValue('ih', Math.max(mouthStretch, mouthSmile));
                    currentVrm.expressionManager.setValue('oh', mouthFunnel);
                }
            }

            if (results.facialTransformationMatrixes && results.facialTransformationMatrixes.length > 0) {
                const matrix = new THREE.Matrix4().fromArray(results.facialTransformationMatrixes[0].data);
                const rotation = new THREE.Euler().setFromRotationMatrix(matrix);

                if (currentVrm) {
                    const head = currentVrm.humanoid.getNormalizedBoneNode('head');
                    const neck = currentVrm.humanoid.getNormalizedBoneNode('neck');
                    if (head && neck) {
                        let pitch = rotation.x; 
                        let yaw = -rotation.y;   
                        let roll = -rotation.z;   
                        
                        head.rotation.set(pitch * 0.5, yaw * 0.5, roll * 0.5);
                        neck.rotation.set(pitch * 0.5, yaw * 0.5, roll * 0.5);
                    }
                }
            }

            // =========================================
            // 🎮 第二階段：遊戲判定 (形音雙重驗證)
            // =========================================
            if (currentTrainingMode === 'mouth' && isGameRunning && poseQueue.length > 0) {
                const targetPose = poseQueue[0];
                const conf = DIFFICULTY_CONFIG[currentDifficulty];

                if (targetPose !== lastTarget) {
                    lastTarget = targetPose;
                    holdTime = 0;
                    turnTimeLeft = 5000;
                    latestSpokenWord = ""; // 換題時清空大腦
                }

                // 驗證 1：臉部動作是否正確？(保留你原本的 MediaPipe 參數邏輯)
                let detected = "";
                if (jawOpen < 0.08 && mouthPucker < 0.5 && mouthStretch < 0.4) {
                    detected = "";
                } else if (mouthFunnel > conf.funnel_O && jawOpen > 0.15) {
                    detected = "ㄛ";
                } else if (mouthPucker > conf.pucker_U && jawOpen > 0.05 && jawOpen < 0.3) {
                    detected = "ㄨ";
                } else if (jawOpen > conf.jaw_A && mouthPucker < 0.3 && mouthFunnel < 0.3) {
                    detected = "ㄚ";
                } else if ((mouthStretch > conf.stretch_I || mouthSmile > conf.stretch_I) && jawOpen < 0.15) {
                    detected = "ㄧ";
                } else if (jawOpen >= 0.1 && jawOpen <= 0.5 && (mouthStretch > conf.stretch_E || mouthSmile > conf.stretch_E)) {
                    detected = "ㄟ";
                }

                let isFaceMatched = (detected === targetPose);

                // 驗證 2：聲音內容是否正確？
                let isVoiceMatched = true; 
                if (isMicEnabled && currentDifficulty !== "easy") {
                    // 不再檢查字有沒有唸對，只要麥克風有收到夠大的聲音就給過
                    isVoiceMatched = (smoothedVolume > conf.volThreshold); 
                }

                const hintMessage = document.getElementById("hint-message");
                const currentBubble = document.getElementById("bubble-0");
                if (targetPose !== lastTarget) {
                    lastTarget = targetPose;
                    holdTime = 0;
                    turnTimeLeft = 5000;
                    latestSpokenWord = ""; 
                }
                if (isTutorialLocked) {
                    if(hintMessage) {
                        hintMessage.innerText = "🔊 請先聽完語音指示喔！";
                        hintMessage.style.color = "#8e44ad";
                    }
                    holdTime = 0; 
                    if(currentBubble) currentBubble.style.background = "";
                } else {
                    if (isFaceMatched && isVoiceMatched) {
                        if(hintMessage) {
                            hintMessage.innerText = isMicEnabled && currentDifficulty !== "easy" ? "👍 動作很棒！請保持住！" : "👍 嘴型很棒！請保持住！";
                            hintMessage.style.color = "#f1c40f";
                        }
                        if (currentBubble) currentBubble.classList.remove("warning-blink");

                        holdTime += dt;
                        let progress = Math.min(holdTime / conf.holdDuration, 1) * 100;
                        if(currentBubble) {
                            currentBubble.style.background = `linear-gradient(to top, #2ecc71 ${progress}%, #3498db ${progress}%)`;
                            currentBubble.style.transform = "scale(1.15)";
                        }

                        if (holdTime >= conf.holdDuration) {
                            triggerResult(true);
                            lastTarget = ""; 
                            latestSpokenWord = "";
                        }
                    } else {
                        if(hintMessage) {
                            if (isFaceMatched && !isVoiceMatched) {
                                hintMessage.innerText = "🎤 嘴型對了！請記得大聲發出聲音喔！";
                            } else {
                                hintMessage.innerText = detected === "" ? "😶 預備！請看著符號，做出動作！" : `🤔 動作不太對喔！(偵測到: ${detected})`;
                            }
                            hintMessage.style.color = "#ffffff";
                        }
                        if (!conf.accumulateProgress) {
                            holdTime = 0;
                            if(currentBubble) { currentBubble.style.background = ""; currentBubble.style.transform = "scale(1)"; }
                        }
                        if (!conf.isTutorial) {
                            turnTimeLeft -= dt;
                            if (turnTimeLeft <= 2000 && currentBubble) currentBubble.classList.add("warning-blink");
                            if (turnTimeLeft <= 0) {
                                triggerResult(false);
                                lastTarget = "";
                            }
                        }
                    }
                }
            }
        }
    }
    requestAnimationFrame(predictLoop);
}