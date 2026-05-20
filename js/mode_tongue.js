// js/mode_tongue.js
// 🌟 確保從 app.js 引入 faceLandmarker
import { faceLandmarker, currentVrm, currentTrainingMode, isGameRunning, currentDifficulty, DIFFICULTY_CONFIG, poseQueue, isTutorialLocked, triggerResult } from './app.js';

const TM_URL = "./tm_model/"; 

let tmModel;
let video;
let isDetecting = false;
let lastTime = performance.now();

// ==========================================
// 🎨 建立一個「隱藏的虛擬畫布」專門用來處理嘴部截圖
// ==========================================
const mouthCanvas = document.createElement('canvas');
const mouthCtx = mouthCanvas.getContext('2d', { willReadFrequently: true });
const PADDING = 40; // 邊距：為伸出的舌頭預留空間 (如果舌頭常被切到，可以調大到 60 或 70)

// 遊戲狀態控制
let holdTime = 0;
let turnTimeLeft = 5000;
let lastTarget = "";

// 穩定器設定
const SMOOTHING_FACTOR = 0.1; 
let smoothedProbs = {
    'Neutral': 1.0,
    'tongueUp': 0.0,
    'tongueDown': 0.0,
    'tongueLeft': 0.0,
    'tongueRight': 0.0
};
//設定機率大於多少才算成功
const GAME_TRIGGER_THRESHOLD = 0.2; 

export async function initTongueMode() {
    console.log("正在載入 Teachable Machine 舌頭模型...");
    const modelURL = TM_URL + "model.json";
    const metadataURL = TM_URL + "metadata.json";

    try {
        tmModel = await window.tmImage.load(modelURL, metadataURL);
        console.log("✅ 舌頭模型載入成功！");
    } catch (error) {
        console.error("❌ 模型載入失敗，請檢查網址是否正確:", error);
    }

    video = document.getElementById("video");
}

export function startTongueDetection() {
    if (isDetecting) return;
    isDetecting = true;
    lastTime = performance.now();
    predictLoop();
}

export function stopTongueDetection() {
    lastTarget = ""; 
}

function checkTonguePoseMatch(targetPose, detectedAction, confidence, threshold) {
    if (confidence <= threshold) return false;
    const poseMap = {
        '⬆️': 'tongueUp',
        '⬇️': 'tongueDown',
        '⬅️': 'tongueLeft',
        '➡️': 'tongueRight'
    };
    return poseMap[targetPose] === detectedAction;
}

// 舌頭專屬的 AI 辨識迴圈
async function predictLoop() {
    if (!isDetecting || currentTrainingMode !== 'tongue') {
        requestAnimationFrame(predictLoop);
        return;
    }

    let currentTime = performance.now();
    let dt = currentTime - lastTime;
    lastTime = currentTime;

    // 確保模型、影像和 MediaPipe 都準備好了
    if (tmModel && video && video.readyState >= 2 && faceLandmarker) {
        
        // =========================================
        // ✂️ 第零階段：利用 MediaPipe 找出嘴巴並截圖
        // =========================================
        const results = faceLandmarker.detectForVideo(video, currentTime);
        
        if (results.faceLandmarks && results.faceLandmarks.length > 0) {
            const landmarks = results.faceLandmarks[0];
            const w = video.videoWidth;
            const h = video.videoHeight;

            // 取得上下左右外嘴唇的節點座標
            const topY = landmarks[0].y * h;
            const bottomY = landmarks[17].y * h;
            const leftX = landmarks[61].x * w;
            const rightX = landmarks[291].x * w;

            // 計算加上 Padding 後的裁切邊界 (限制不能超過影片原始尺寸)
            const cropTop = Math.max(0, topY - PADDING);
            const cropBottom = Math.min(h, bottomY + PADDING);
            const cropLeft = Math.max(0, leftX - PADDING);
            const cropRight = Math.min(w, rightX + PADDING);

            const cropWidth = cropRight - cropLeft;
            const cropHeight = cropBottom - cropTop;

            if (cropWidth > 0 && cropHeight > 0) {
                // 將虛擬畫布設為裁切的大小
                mouthCanvas.width = cropWidth;
                mouthCanvas.height = cropHeight;
                
                // 將影片的嘴部區域畫到虛擬畫布上
                mouthCtx.drawImage(
                    video, 
                    cropLeft, cropTop, cropWidth, cropHeight, // 來源裁切座標
                    0, 0, cropWidth, cropHeight               // 畫布目標座標
                );

                // 🌟 關鍵修正：把「虛擬畫布(mouthCanvas)」餵給 TM 模型，而不是整張臉的 video！
                const predictions = await tmModel.predict(mouthCanvas);

                // =========================================
                // 🌟 第一階段：訊號平滑處理 (Stabilization) + 名稱轉換
                // =========================================
                const tmToInternalMap = {
                    '沒伸舌頭': 'Neutral',
                    '上': 'tongueUp',
                    '下': 'tongueDown',
                    '左': 'tongueLeft',
                    '右': 'tongueRight'
                };

                predictions.forEach(p => {
                    const originalName = p.className; 
                    const internalName = tmToInternalMap[originalName] || originalName; 
                    const rawProb = p.probability;
                    
                    if (!(internalName in smoothedProbs)) smoothedProbs[internalName] = 0.0;
                    smoothedProbs[internalName] = smoothedProbs[internalName] * (1 - SMOOTHING_FACTOR) + rawProb * SMOOTHING_FACTOR;
                });

                let detected = "";
                let highestConfidentProb = 0;
                const directionalPoses = ['tongueUp', 'tongueDown', 'tongueLeft', 'tongueRight'];

                directionalPoses.forEach(poseName => {
                    if (smoothedProbs[poseName] > highestConfidentProb) {
                        highestConfidentProb = smoothedProbs[poseName];
                        detected = poseName;
                    }
                });

                // =========================================
                // 🌟 第二階段：動作定格魔法 
                // =========================================
                if (currentVrm) {
                    try {
                        ['tongueOut', 'tongueUp', 'tongueDown', 'tongueLeft', 'tongueRight'].forEach(exp => {
                            currentVrm.expressionManager.setValue(exp, 0);
                        });

                        if (highestConfidentProb > 0.4 && detected !== "") {
                            currentVrm.expressionManager.setValue('tongueOut', 0.8); 
                            currentVrm.expressionManager.setValue(detected, 0.2);    
                        }
                    } catch (e) {}
                }

                // =========================================
                // 🎮 第三階段：遊戲過關判定
                // =========================================
                if (isGameRunning && poseQueue.length > 0) {
                    const targetPose = poseQueue[0]; 
                    const conf = DIFFICULTY_CONFIG[currentDifficulty];

                    // 開發者偵錯用的 log，確認機率有在變動
                    console.log(`[AI 判定] ${detected} (${(highestConfidentProb*100).toFixed(0)}%) | 上:${(smoothedProbs['tongueUp']*100).toFixed(0)} 下:${(smoothedProbs['tongueDown']*100).toFixed(0)} 左:${(smoothedProbs['tongueLeft']*100).toFixed(0)} 右:${(smoothedProbs['tongueRight']*100).toFixed(0)}`);

                    const isMatched = checkTonguePoseMatch(targetPose, detected, highestConfidentProb, GAME_TRIGGER_THRESHOLD);
                    const hintMessage = document.getElementById("hint-message");
                    const currentBubble = document.getElementById("bubble-0");

                    if (targetPose !== lastTarget) {
                        lastTarget = targetPose;
                        holdTime = 0;
                        turnTimeLeft = 10000; //等待10秒
                    }

                    if (isTutorialLocked) {
                        if(hintMessage) {
                            hintMessage.innerText = "🔊 請先聽完語音指示喔！";
                            hintMessage.style.color = "#8e44ad";
                        }
                        holdTime = 0; 
                        if(currentBubble) currentBubble.style.background = "";
                    } else {
                        if (isMatched) {
                            if(hintMessage) {
                                hintMessage.innerText = "👍 舌頭方向正確！請保持住！";
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
                            }
                        } else {
                            if(hintMessage) {
                                hintMessage.innerText = highestConfidentProb > (GAME_TRIGGER_THRESHOLD - 0.2) ? `🤔 方向不太對喔！` : "👅 預備！請對著鏡頭伸出舌頭！";
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
    }
    requestAnimationFrame(predictLoop);
}