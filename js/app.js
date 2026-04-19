// ==========================================
// 核心模組載入 (總指揮官)
// ==========================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';
import { FaceLandmarker, FilesetResolver } from "https://cdn.skypack.dev/@mediapipe/tasks-vision@0.10.3";

import { initMouthMode, startMouthDetection, stopMouthDetection, resumeAudio, setMicStatus } from './mode_mouth.js';
import { startVoiceDetection,stopVoiceDetection ,voiceConfig,stopTfjsDetection,initTfjsVoice,startTfjsDetection} from './mode_voice.js';

// ==========================================
// 全域變數匯出 (讓其他模組可以使用)
// ==========================================
export let currentVrm = null;
export let isGameRunning = false;
export let currentDifficulty = "hard";
export let currentTrainingMode = "mouth";
export let poseQueue = [];
export let isTutorialLocked = false;
export let accumulatedHoldTime = 0;
export let videoElement;//全域的攝影機
export let globalStream;//影像與聲音源頭,後續運算都可以從這邊拿資料
export let faceLandmarker;//MediaPipe元件

//各等級辨識參數
export const DIFFICULTY_CONFIG = {
    tutorial: { requireAudio: true, volThreshold: 15, holdDuration: 1500, accumulateProgress: true, isTutorial: true, jaw_A: 0.25, pucker_U: 0.4, funnel_O: 0.25, stretch_I: 0.3, stretch_E: 0.15 },
    easy: { requireAudio: false, volThreshold: 0, holdDuration: 2000, accumulateProgress: true, isTutorial: false, jaw_A: 0.25, pucker_U: 0.4, funnel_O: 0.25, stretch_I: 0.3, stretch_E: 0.15 },
    medium: { requireAudio: true, volThreshold: 15, holdDuration: 2000, accumulateProgress: false, isTutorial: false, jaw_A: 0.35, pucker_U: 0.55, funnel_O: 0.35, stretch_I: 0.4, stretch_E: 0.25 },
    hard: { requireAudio: true, volThreshold: 25, holdDuration: 2000, accumulateProgress: false, isTutorial: false, jaw_A: 0.45, pucker_U: 0.7, funnel_O: 0.4, stretch_I: 0.5, stretch_E: 0.35 }
};

// --- 私有 UI 與遊戲變數 ---
let scene, camera, renderer, clock;
let turnTimeLeft = 5000;
let blinkTimer = 0;
let nextBlinkInterval = 3;

export let gameStats = {};

// 音效設定
const bgm = new Audio('./bgm.mp3');
bgm.loop = true;
bgm.volume = 1; 

// ==========================================
// 1. 初始化系統與 3D 渲染
// ==========================================
async function startSystem() {
    initThreeJS(); 
    await initMediaPipe();
    await initCamera();
    await initMouthMode();
    // await initTfjsVoice();
    // try {
    //     await Promise.all([
    //         await initMouthMode(),

    //         await initTfjsVoice() //語音TM model
    //     ]);
        
    //     console.log("✅ 所有 AI 大腦已載入完成");
    // } catch (err) {
    //     console.error("❌ 模型載入發生錯誤", err);
    // }
    
    // 系統載入完成後，立刻啟動背景頭部/嘴部追蹤，永遠不關閉 
    startMouthDetection(); 

    //隱藏請稍候提示,顯示開始遊戲按鈕
    unlockGameUI();
}

async function initMediaPipe(){
    console.log("正在載入 MediaPipe 臉部追蹤與語音辨識模組...");
    //載入MediaPipe
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
}

export async function initCamera() {
    console.log("📷 正在啟動全域攝影機與麥克風...");
    
    // 1. 建立或取得唯一的 video 標籤
    videoElement = document.getElementById("video");
    if (!videoElement) {
        videoElement = document.createElement('video');
        videoElement.id = 'video';
        videoElement.autoplay = true;
        videoElement.playsInline = true;
        videoElement.style.display = 'none';
        document.body.appendChild(videoElement);
    }

    // 2. 要求硬體權限
    try {
        globalStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        videoElement.srcObject = globalStream;

        // 🌟 關鍵：必須等 video 準備好，才算真的載入完成
        return new Promise((resolve) => {
            videoElement.onloadedmetadata = () => {
                videoElement.play();
                console.log("✅ 全域攝影機與麥克風啟動完成");
                resolve();
            };
        });
    } catch (err) {
        console.error("❌ 無法取得攝影機或麥克風權限", err);
        alert("請允許使用攝影機與麥克風才能進行遊戲！");
        throw err; // 把錯誤往上丟，阻止後續載入
    }
}

function unlockGameUI(){
    document.getElementById("loading-overlay").style.display = "none";
    const btns = ["btn-tutorial", "btn-easy", "btn-medium", "btn-hard"];
    btns.forEach(id => {
        const btn = document.getElementById(id);
        if(btn) btn.disabled = false;
    });
}

function initThreeJS() {
    const container = document.getElementById("canvas-container");
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xb1e1ff); 

    camera = new THREE.PerspectiveCamera(30, container.clientWidth / container.clientHeight, 0.1, 20);
    camera.position.set(0, 1.52, 0.8); 
    camera.lookAt(0, 1.52, 0); 

    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.outputColorSpace = THREE.SRGBColorSpace; 
    container.appendChild(renderer.domElement);

    const light = new THREE.DirectionalLight(0xffffff, 0.4); 
    light.position.set(1, 1, 1).normalize();
    scene.add(light);
    scene.add(new THREE.AmbientLight(0xffffff, 0.3)); 

    const textureLoader = new THREE.TextureLoader();
    textureLoader.load('./bg_grassland.jpg', texture => {
        texture.colorSpace = THREE.SRGBColorSpace;
        scene.background = texture;
    });
    
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    loader.load("./vrm/VRMWithTongue.vrm", (gltf) => {
        const vrm = gltf.userData.vrm;
        scene.add(vrm.scene);
        currentVrm = vrm;
        vrm.scene.rotation.y = 0; 
        
        const leftUpperArm = vrm.humanoid.getNormalizedBoneNode('leftUpperArm');
        const rightUpperArm = vrm.humanoid.getNormalizedBoneNode('rightUpperArm');
        if (leftUpperArm) leftUpperArm.rotation.z = -1.1; 
        if (rightUpperArm) rightUpperArm.rotation.z = 1.1;
    });

    clock = new THREE.Clock();
    animate3D();
}

function animate3D() {
    requestAnimationFrame(animate3D);
    const deltaTime = clock.getDelta();
    
    if (currentVrm) {
        blinkTimer += deltaTime;
        let blinkValue = 0;
        if (blinkTimer >= nextBlinkInterval) {
            let blinkPhase = blinkTimer - nextBlinkInterval; 
            if (blinkPhase < 0.1) blinkValue = blinkPhase / 0.1;
            else if (blinkPhase < 0.2) blinkValue = 1 - ((blinkPhase - 0.1) / 0.1);
            else {
                blinkTimer = 0;
                nextBlinkInterval = 2 + Math.random() * 3;
                blinkValue = 0;
            }
        }
        currentVrm.expressionManager.setValue('blinkLeft', blinkValue);
        currentVrm.expressionManager.setValue('blinkRight', blinkValue);
        currentVrm.expressionManager.setValue('blink', blinkValue); 
        currentVrm.update(deltaTime);
    }
    renderer.render(scene, camera);
}

// ==========================================
// 2. 模式切換邏輯
// ==========================================
document.getElementById("mode-mouth")?.addEventListener('click', () => switchTrainingMode('mouth'));
document.getElementById("mode-voice")?.addEventListener('click', () => switchTrainingMode('voice'));
document.getElementById("mode-tongue")?.addEventListener('click', () => switchTrainingMode('tongue'));

function switchTrainingMode(mode) {
    if (isGameRunning) return; //遊戲進行中不能更換模式
    stopAllEngines(); //請除所有的語音偵測辨識冷卻狀態
    currentTrainingMode = mode;
    console.log(`切換至訓練模式：${mode}`);
    // UI 按鈕切換
    document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`mode-${mode}`)?.classList.add('active');
    initQueue(); //根據新的 currentTrainingMode，重新去各自的模組（如嘴型題庫、發聲題庫）抓取對應的關卡資料，重新填滿陣列
}

// ==========================================
// 3. 遊戲流程控制 (開始、結束、過關判定)
// ==========================================

// 安全綁定點擊事件
document.getElementById("btn-tutorial")?.addEventListener('click', () => startGame("tutorial"));
document.getElementById("btn-easy")?.addEventListener('click', () => startGame("easy"));
document.getElementById("btn-medium")?.addEventListener('click', () => startGame("medium"));
document.getElementById("btn-hard")?.addEventListener('click', () => startGame("hard"));
document.getElementById("endBtn")?.addEventListener('click', endGame);

// 🎙️ 修復：語音判定開關按鈕 (點擊時同步隱藏/顯示音量條)
document.getElementById("toggleMicBtn")?.addEventListener('click', (e) => {
    const btn = e.target;
    const isOn = btn.innerText.includes('開啟');
    const meterContainer = document.getElementById("audio-meter-container");

    if (isOn) {
        btn.innerText = '🎙️ 語音判定：關閉';
        btn.classList.add('off');
        setMicStatus(false);
        // 👇 改用 visibility 隱藏，保留空間
        if (meterContainer) meterContainer.style.visibility = "hidden"; 
    } else {
        btn.innerText = '🎙️ 語音判定：開啟';
        btn.classList.remove('off');
        setMicStatus(true);
        // 👇 改用 visibility 顯示
        if (meterContainer && isGameRunning) meterContainer.style.visibility = "visible"; 
    }
});

// 強制暴露給全域
window.startGame = startGame;
window.endGame = endGame;

// 📖 修復：定義新手教學的專屬順序 (ㄚ、ㄧ、ㄨ 循環 3 次，共 9 題)
let tutorialIndex = 0;
const TUTORIAL_SEQUENCE = ["ㄚ", "ㄧ", "ㄨ", "ㄚ", "ㄧ", "ㄨ", "ㄚ", "ㄧ", "ㄨ"];

function startGame(mode) {
    // 確保音訊環境啟動
    import('./mode_mouth.js').then(module => {
        if(module.resumeAudio) module.resumeAudio(); 
    });
    currentDifficulty = mode; 
    isGameRunning = true;
    isTutorialLocked = (mode === "tutorial"); 
    tutorialIndex = 0; 
    
    bgm.play().catch(e => {});

    const micBtn = document.getElementById("toggleMicBtn");
    const isMicOff = micBtn && micBtn.classList.contains('off');
    const isEasyMode = (mode === "easy");
    const isTongueMode = (currentTrainingMode === 'tongue'); 

    // 🌟 修復 1：動態重置統計資料 (根據不同模式準備不同的計分板)
    gameStats = {};
    let statKeys = [];
    if (currentTrainingMode === 'mouth') statKeys = ["ㄚ", "ㄧ", "ㄨ", "ㄟ", "ㄛ"];
    else if (currentTrainingMode === 'tongue') statKeys = ['⬆️', '⬇️', '⬅️', '➡️'];
    else if (currentTrainingMode === 'voice') statKeys = ["PA", "TA", "KA", "LA"];
    
    statKeys.forEach(k => { gameStats[k] = { success: 0, fail: 0 }; });

    // 切換 UI 顯示狀態
    changeUIshow(currentTrainingMode === 'voice');
    const meterContainer = document.getElementById("audio-meter-container");

    // 🌟 UI 與麥克風強制連動邏輯
    if (currentTrainingMode === 'voice') {
            // 🗣️ 發聲模式：隱藏按鈕，顯示音量條，並【強制開啟麥克風】
            if (micBtn) { micBtn.style.display = "none"; }
            setMicStatus(true); 
            startVoiceDetection();
    } 
    else if (isTongueMode) {
        // 👅 舌頭模式：不需要聲音，全部隱藏
        if (micBtn) { micBtn.style.display = "none"; }
        if (meterContainer) { meterContainer.style.display = "none"; }
    } 
    else {
        // 👄 嘴型模式：依據難度顯示
        if (micBtn) {
            micBtn.style.display = "block";
            micBtn.style.display = isEasyMode ? "none" : "block";
        }
        if (meterContainer) {
            meterContainer.style.display = "flex";
            meterContainer.style.visibility = (isEasyMode || isMicOff) ? "hidden" : "visible";
        }
        setMicStatus(!isMicOff);
    }

    let volumeLevel = getVolumeLevel();
    const thresholdLine = document.getElementById("meter-threshold");
    if (thresholdLine) {
        let leftPercentage = (volumeLevel / 80) * 100;
        leftPercentage = Math.min(leftPercentage, 100);
        // 更新 CSS 的 left 屬性
        thresholdLine.style.left = `${leftPercentage}%`;
    }

    initQueue();  //載入題目
    renderBelt(); //渲染畫面
    startTurnTimer();
}

export function getVolumeLevel(){
    let num ;
    if(currentDifficulty === "hard"){
        num = 40;
    }else if(currentDifficulty === "medium"){
        num = 30;
    }else{
        num = 20;
    }

    return num;
}

function endGame() {
    isGameRunning = false;
    isTutorialLocked = false; 
    bgm.pause();
    window.speechSynthesis.cancel(); 
    stopAllEngines();
    // 隱藏舌頭的冰淇淋
    const ic = document.getElementById("ice-cream-target");
    if (ic) ic.style.display = "none";

    // 🌟 修復 3：遊戲結束時強制隱藏巨石介面
    const voiceUI = document.getElementById("voice-game-ui");
    if (voiceUI) voiceUI.style.display = "none";

    // 恢復 UI 顯示狀態
    const els = {
        "tutorial-controls": "flex",
        "start-controls": "flex",
        "game-controls": "none",
        "game-ui": "none",
        "audio-meter-container": "none" ,
        "mode-mouth":"flex", //嘴型訓練按鈕
        "mode-voice":"flex", //發聲訓練按鈕
        "mode-tongue":"flex", //舌頭訓練按鈕
        "hint-message":"none", //遊戲內提示文字
         "game-title":"flex" //遊戲標題
    };
    for (let id in els) {
        let el = document.getElementById(id);
        if (el) el.style.display = els[id];
    }
    
    // 🌟 修復 4：動態生成符合當前模式的結算報表
    const statusDisplay = document.getElementById("status-message");
    if (statusDisplay) {
        if (currentDifficulty !== "tutorial") { 
            statusDisplay.innerText = "挑戰結束！查看結算：";
            const statsPanel = document.getElementById("stats-panel");
            if (statsPanel) {
                statsPanel.style.display = "block";
                let html = '<h3 style="color: #333; text-align: center;">📊 動作達成率統計</h3><ul style="color: #333; font-size: 18px; padding-left: 20px;">';
                
                for (let key in gameStats) {
                    if (currentTrainingMode === 'voice') {
                        // 發聲模式專屬文字
                        html += `<li style="margin-bottom: 10px;"><strong>${key}</strong>: 成功擊碎 ${gameStats[key].success} 顆巨石</li>`;
                    } else {
                        // 嘴型與舌頭模式的文字
                        let total = gameStats[key].success + gameStats[key].fail;
                        let rate = total > 0 ? Math.round((gameStats[key].success / total) * 100) : 0;
                        html += `<li style="margin-bottom: 10px;"><strong>${key}</strong>: 成功 ${gameStats[key].success} 次 / 失敗 ${gameStats[key].fail} 次 (達成率: ${rate}%)</li>`;
                    }
                }
                html += '</ul>';
                statsPanel.innerHTML = html;
            }
        } else {
            statusDisplay.innerText = "已離開教學模式，請選擇難度開始挑戰！";
        }
    }
}

// ==========================================
// 4. 遊戲軌道與進度相關輔助函數
// ==========================================

// 📖 動態取得教學順序 (根據當前模式切換)
function getTutorialSequence() {
    if (currentTrainingMode === 'tongue') {
        return ["⬆️", "⬇️", "⬅️", "➡️", "⬆️", "⬇️", "⬅️", "➡️", "⬆️"];
    }
    if (currentTrainingMode === 'voice') {
        return voiceConfig.voiceTutorialTopic;
    }
    return ["ㄚ", "ㄧ", "ㄨ", "ㄚ", "ㄧ", "ㄨ", "ㄚ", "ㄧ", "ㄨ"];
}

function getSequence() {
    if (currentTrainingMode === 'tongue') {
        return ["⬆️", "⬇️", "⬅️", "➡️"];
    }
    if (currentTrainingMode === 'voice') {
        return ["PA", "TA", "KA", "LA"];
    }
    return ["ㄚ", "ㄧ", "ㄨ"];
}

function initQueue() {
    poseQueue = [];
    if (currentDifficulty === "tutorial") {
        // 新手教學題目
        const seq = getTutorialSequence();
        for (let i = 0; i < 6; i++) poseQueue.push(seq[i]);
    } else {
        // 初中高級題目
        let targetList = getSequence();
        for (let i = 0; i < 6; i++) poseQueue.push(targetList[Math.floor(Math.random() * targetList.length)]);
    }
    if(isGameRunning){
        renderBelt();
    } 
        
}

//不管任何狀態只要呼叫就將輸送帶重新渲染
export function renderBelt() {
    if (poseQueue.length === 0) return;
    if (currentTrainingMode === 'voice') {
        // ==========================================
        // 🎤 發聲模式：渲染中央大石頭
        // ==========================================
        const stone = document.getElementById("stone-container");
        const text = document.getElementById("stone-text");
        const hp = document.getElementById("stone-hp");
        voiceConfig.remainingHits = (currentDifficulty === 'tutorial') ? 1 : voiceConfig.MAX_HEALTH;//教學模式血量1
        if (stone && text && hp) {
            stone.className = ""; // 瞬間洗掉上一回合的爆炸或震動動畫
            text.innerText = poseQueue[0]; // 直接從陣列拿最新的題目
            
            // 確保畫面上顯示最新的血量 (remainingHits 需要是全域變數，並在呼叫此函式前先更新好)
            hp.innerText = `剩餘 ${voiceConfig.remainingHits} 次`; 
        }

    }
    else {
        // ==========================================
        // 👄👅 嘴型/舌頭模式：渲染無限輸送帶泡泡
        // ==========================================
        const conveyorBelt = document.getElementById("conveyor-belt");//輸送帶元素
        if (!conveyorBelt) return;

        conveyorBelt.innerHTML = "";
        conveyorBelt.style.transition = "none";//關閉動畫顯示不然translateX(0)將泡泡拉回時,會顯示出泡泡向右移動
        conveyorBelt.style.transform = "translateX(0)";

        poseQueue.forEach((pose, index) => { //泡泡渲染回來
            const bubble = document.createElement("div");
            bubble.className = "bubble";
            
            if (index === 0) {
                bubble.classList.add("current");;//最左側泡泡加大加粗
            }
            
            bubble.id = `bubble-${index}`;
            bubble.innerText = pose;
            conveyorBelt.appendChild(bubble);
        });
    }
}

function startTurnTimer() {
    if (!isGameRunning || poseQueue.length === 0) return;
    const targetPose = poseQueue[0]; //當前題目
    const statusDisplay = document.getElementById("status-message");
    if (statusDisplay) statusDisplay.innerText = `${targetPose} 維持！！！`;
    accumulatedHoldTime = 0; 

    // 教學語音提示
    let spokenText = targetPose;
    if (currentTrainingMode === 'mouth') {
        spokenText = `請跟著喊：${targetPose}`
    } else if (currentTrainingMode === 'voice') {
        let targetString;
        if (targetPose === 'PA') targetString = '趴';
        else if (targetPose === 'TA') targetString = '他';
        else if (targetPose === 'KA') targetString = '咖';
        else if (targetPose === 'LA') targetString = '拉';
        spokenText = `大聲喊出：${targetString}`
    } else if (currentTrainingMode === 'tongue') {
        if (targetPose === '⬆️') spokenText = '舌頭往上';
        else if (targetPose === '⬇️') spokenText = '舌頭往下';
        else if (targetPose === '⬅️') spokenText = '舌頭往左';
        else if (targetPose === '➡️') spokenText = '舌頭往右';
    }

    const currentBubble = document.getElementById("bubble-0");//取得最左邊泡泡
    const stone = document.getElementById("stone-container"); //取得石頭
    window.speechSynthesis.cancel(); 
    const utterance = new SpeechSynthesisUtterance(spokenText);
    utterance.lang = "zh-TW";

    let lockThreshold = 4; //設定教學模式前面多少題要聽完語音才能動作
    if (currentTrainingMode === 'mouth') {
        lockThreshold = 3;
    } else if (currentTrainingMode === 'voice') {
        voiceConfig.lockThreshold = 4;
    } else if (currentTrainingMode === 'tongue') {
        lockThreshold = 4;
    }
    
    if (currentDifficulty === "tutorial" && tutorialIndex < lockThreshold) {
        //處於教學模式，且關卡還沒超過門檻，嚴格鎖定防搶拍
        isTutorialLocked = true; 
        //加上禁止符號特效
        if(currentTrainingMode === 'voice'){
            if(stone){
                stone.classList.add("locked");
            }
        }else{
            if (currentBubble){
                currentBubble.classList.add("locked");
            }
        }
        utterance.onend = () => {
            isTutorialLocked = false; // 語音乖乖唸完後，才解鎖讓玩家動作
            if (currentBubble) currentBubble.classList.remove("locked");
            if (stone) stone.classList.remove("locked");
        };
        // ✅ 只有在教學模式，且遊戲真的在跑，才說話
        if (isGameRunning) {
            window.speechSynthesis.speak(utterance);
        }
        
    } else {
        //已經超過教學門檻，不鎖定，可邊聽邊做或直接做
        isTutorialLocked = false; 
        // 防禦性編程：確保不需要鎖定時，泡泡絕對不會卡著禁止符號
        if (currentBubble) currentBubble.classList.remove("locked");
        if (stone) stone.classList.remove("locked");
    }
}

// 過關/失敗處理器
export function triggerResult(isSuccess) {
    const targetBubble = document.getElementById("bubble-0");
    const conveyorBelt = document.getElementById("conveyor-belt");
    const ic = document.getElementById("ice-cream-target"); 
    const stone = document.getElementById("stone-container");

    if (isSuccess) {
        gameStats[poseQueue[0]] && gameStats[poseQueue[0]].success++;//類計成功次數
        if (currentTrainingMode === 'mouth') {
            if(targetBubble) targetBubble.classList.add("pop-animation"); //成功時，泡泡（bubble-0）會播放破裂動畫（pop-animation）。
        } else if (currentTrainingMode === 'voice') {
            if(stone) stone.classList.add("stone-explode"); //石頭破碎動畫
        } else if (currentTrainingMode === 'tongue') {
            if(targetBubble) targetBubble.classList.add("pop-animation"); //成功時，泡泡（bubble-0）會播放破裂動畫（pop-animation）。
            if (ic && currentTrainingMode === 'tongue') ic.classList.add('ic-pop'); //冰淇淋（ice-cream-target）的專屬特效
        }
    } else {
        gameStats[poseQueue[0]] && gameStats[poseQueue[0]].fail++; //類計失敗次數
        if(targetBubble) targetBubble.classList.add("fade-animation"); //泡泡失敗特效
    }

    if (conveyorBelt) { //輸送帶推進動畫,將泡泡向左移動
        conveyorBelt.style.transition = "transform 0.5s ease-in-out";
        conveyorBelt.style.transform = "translateX(-110px)"; 
    }

    setTimeout(() => {
        poseQueue.shift(); // 移除已經判定過的目標
        
        // 👇 徹底分流：確保教學結束就是結束，一般模式就是無限隨機
        if (currentDifficulty === "tutorial") { 
            tutorialIndex++;
            if (tutorialIndex >= 9) { //教學題目共9提超過9題就結束
                endGame();
                const statusDisplay = document.getElementById("status-message");
                if (statusDisplay) statusDisplay.innerText = "🎉 新手教學完成！請選擇難度開始挑戰！";
                return; 
            }
            const seq = getTutorialSequence(); //取得各模式教學題目庫
            
            let nextItemIndex = tutorialIndex + 5; //輸送帶總共會顯示5到6個題目
            if (nextItemIndex < seq.length) {
                poseQueue.push(seq[nextItemIndex]); //讓玩家能看到後續的題目
            }
            
        } else {
            // 一般難度的無限替補
            let targetList = getSequence();//取得一般模式題目庫
            poseQueue.push(targetList[Math.floor(Math.random() * targetList.length)]);//隨機塞入題目
        }

        renderBelt();  //根據更新後的 poseQueue 重新畫出輸送帶上的內容
        startTurnTimer(); //負責推進遊戲的「流程與邏輯」
    }, 500); //設定為500毫秒對其上方的輸送帶動畫時間
}

function changeUIshow(isVoiceMode){
const els = {
        "tutorial-controls": "none",
        "start-controls": "none",
        "game-controls": "flex",
        "game-ui": isVoiceMode ? "none" : "flex",
        "voice-game-ui": isVoiceMode ? "flex" : "none", 
        "stats-panel": "none",
        "audio-meter-container": "flex" ,
        "mode-mouth":"none", //嘴型訓練按鈕
        "mode-voice":"none", //發聲訓練按鈕
        "mode-tongue":"none", //舌頭訓練按鈕
        "hint-message":"flex", //遊戲內提示文字
        "game-title":"none" //遊戲標題
    };
    for (let id in els) {
        let el = document.getElementById(id);
        if (el) el.style.display = els[id];
    }
}

/**
 * 🧹 全域偵測清理器
 * 負責把所有正在運行的偵測引擎（語音、模型、計時器）徹底關閉
 */
function stopAllEngines() {
    isGameRunning = false;
    stopMouthDetection();
    stopTfjsDetection();
    stopVoiceDetection();
}
// 啟動系統
startSystem();