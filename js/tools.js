/**
 * 裁切嘴部影像並觸發下載
 * @param {HTMLVideoElement} video - 視訊來源
 * @param {Array} landmarks - MediaPipe 特徵點
 * @param {string} fileName - 存檔檔名 (例如 "tongue_out_001.png")
 */
async function captureAndSaveMouth(video, landmarks, fileName = 'sample.png') {
    if (!landmarks) return;

    // 1. 建立一個離屏畫布 (Offscreen Canvas) 處理裁切
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = 224;  // Teachable Machine 預設大小
    cropCanvas.height = 224;
    const ctx = cropCanvas.getContext('2d');

    // 2. 計算裁切區域 (延用之前的邏輯，確保正方形)
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;
    const mouthIndices = [61, 291, 0, 17];
    const points = mouthIndices.map(i => ({
        x: landmarks[i].x * videoWidth,
        y: landmarks[i].y * videoHeight
    }));

    const minX = Math.min(...points.map(p => p.x));
    const maxX = Math.max(...points.map(p => p.x));
    const minY = Math.min(...points.map(p => p.y));
    const maxY = Math.max(...points.map(p => p.y));
    
    const centerX = minX + (maxX - minX) / 2;
    const centerY = minY + (maxY - minY) / 2;
    const sideLength = Math.max(maxX - minX, maxY - minY) * 1.5; // 加入 50% 襯距

    // 3. 繪製到畫布
    ctx.drawImage(
        video, 
        centerX - sideLength / 2, centerY - sideLength / 2, sideLength, sideLength,
        0, 0, 224, 224
    );

    // 4. 將畫布轉為 Blob 並觸發下載
    cropCanvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName; // 瀏覽器會存入下載資料夾
        link.click();
        URL.revokeObjectURL(url);
    }, 'image/png');
}