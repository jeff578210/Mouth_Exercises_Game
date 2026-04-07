// js/mode_tongue.js
import { currentVrm, currentTrainingMode, isGameRunning, currentDifficulty, DIFFICULTY_CONFIG, poseQueue, isTutorialLocked, triggerResult } from './app.js';

// 🔥 記得換成你的 TM 模型網址 (結尾要有 /) 或本地路徑
const TM_URL = "./tm_model/"; 

let tmModel;
let video;
let isDetecting = false;
let lastTime = performance.now();

// 遊戲狀態控制
let holdTime = 0;
let turnTimeLeft = 5000;
let lastTarget = "";

// ==========================================
// 🌟 穩定器：平滑設定 (解決閃爍問題)
// ==========================================
// 平滑係數：數值越小越平滑但有延遲，數值越大越靈敏但容易抖動 (建議 0.1 ~ 0.15)
const SMOOTHING_FACTOR = 0.1; 

// 紀錄經過平滑處理後的機率 (初始預設為 Neutral 100%)
let smoothedProbs = {
    'Neutral': 1.0,
    'tongueUp': 0.0,
    'tongueDown': 0.0,
    'tongueLeft': 0.0,
    'tongueRight': 0.0
};

// 遊戲判定門檻：機率必須超過這個數值才會觸發過關 (避免雜訊誤判)
const GAME_TRIGGER_THRESHOLD = 0.6; 


// 初始化 TM 模型
export async function initTongueMode() {
    console.log("正在載入 Teachable Machine 舌頭模型 (啟用穩定器)...");
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
    lastTarget = ""; // 只清空目標，不關閉 AI 迴圈
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

    if (tmModel && video && video.readyState >= 2) {
        const predictions = await tmModel.predict(video);
        
        // =========================================
        // 🌟 第一階段：訊號平滑處理 (Stabilization)
        // =========================================
        predictions.forEach(p => {
            const className = p.className;
            const rawProb = p.probability;
            
            if (!(className in smoothedProbs)) smoothedProbs[className] = 0.0;

            // 魔法公式：新的平滑值 = (舊值 * 0.9) + (新抓到的值 * 0.1)
            smoothedProbs[className] = smoothedProbs[className] * (1 - SMOOTHING_FACTOR) + rawProb * SMOOTHING_FACTOR;
        });

        // =========================================
        // 🌟 第二階段：動作定格魔法 (不再做物理模擬)
        // =========================================
        if (currentVrm) {
            try {
                // 1. 先把所有舌頭表情強制歸零 (收回嘴巴)
                ['tongueOut', 'tongueUp', 'tongueDown', 'tongueLeft', 'tongueRight'].forEach(exp => {
                    currentVrm.expressionManager.setValue(exp, 0);
                });

                // 2. 只要 AI 有一點點信心 (機率 > 0.4)，就瞬間定格到指定位置！
                if (highestConfidentProb > 0.4 && detected !== "") {
                    currentVrm.expressionManager.setValue('tongueOut', 0.8); // 固定伸出的漂亮長度
                    currentVrm.expressionManager.setValue(detected, 1.0);    // 方向直接拉滿 100%
                }
            } catch (e) {}
        }

        // =========================================
        // 🎮 第三階段：遊戲過關判定 (使用平滑後的資料)
        // =========================================
        if (isGameRunning && poseQueue.length > 0) {
            const targetPose = poseQueue[0]; 
            const conf = DIFFICULTY_CONFIG[currentDifficulty];
            
            let detected = "";
            let highestConfidentProb = 0;
            const directionalPoses = ['tongueUp', 'tongueDown', 'tongueLeft', 'tongueRight'];

            directionalPoses.forEach(poseName => {
                if (smoothedProbs[poseName] > highestConfidentProb) {
                    highestConfidentProb = smoothedProbs[poseName];
                    detected = poseName;
                }
            });

            // 👇👇👇 請在這裡新增這行偵錯代碼 👇👇👇
            console.log(`[AI 偵測] 判定: ${detected} (${(highestConfidentProb*100).toFixed(1)}%) | ⬆️上:${(smoothedProbs['tongueUp']||0).toFixed(2)} ⬇️下:${(smoothedProbs['tongueDown']||0).toFixed(2)} ⬅️左:${(smoothedProbs['tongueLeft']||0).toFixed(2)} ➡️右:${(smoothedProbs['tongueRight']||0).toFixed(2)}`);
            // 👆👆👆 新增結束 👆👆👆

            // 必須超過 GAME_TRIGGER_THRESHOLD (0.75) 才算判定成功
            let isMatched = false;
            if (targetPose === '⬆️' && detected === 'tongueUp' && highestConfidentProb > GAME_TRIGGER_THRESHOLD) isMatched = true;
            else if (targetPose === '⬇️' && detected === 'tongueDown' && highestConfidentProb > GAME_TRIGGER_THRESHOLD) isMatched = true;
            else if (targetPose === '⬅️' && detected === 'tongueLeft' && highestConfidentProb > GAME_TRIGGER_THRESHOLD) isMatched = true;
            else if (targetPose === '➡️' && detected === 'tongueRight' && highestConfidentProb > GAME_TRIGGER_THRESHOLD) isMatched = true;

            const hintMessage = document.getElementById("hint-message");
            const currentBubble = document.getElementById("bubble-0");

            if (targetPose !== lastTarget) {
                lastTarget = targetPose;
                holdTime = 0;
                turnTimeLeft = 5000;
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
    requestAnimationFrame(predictLoop);
}