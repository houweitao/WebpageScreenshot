// Service Worker for Chrome Extension V3

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'captureFullPage') {
        captureFullPageOptimized(request.tabId)
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // 保持消息通道开放以进行异步响应
    }
});

async function captureFullPage(tabId) {
    try {
        // 注入脚本获取页面完整尺寸
        const [result] = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            function: getPageDimensions
        });
        
        const { scrollWidth, scrollHeight, viewportWidth, viewportHeight } = result.result;
        
        // 如果页面没有滚动内容，直接截取可见区域
        if (scrollWidth <= viewportWidth && scrollHeight <= viewportHeight) {
            const dataUrl = await chrome.tabs.captureVisibleTab();
            await downloadImage(dataUrl, 'full');
            return { success: true };
        }
        
        // 计算需要截取的片段数量
        const cols = Math.ceil(scrollWidth / viewportWidth);
        const rows = Math.ceil(scrollHeight / viewportHeight);
        
        // 存储所有截图片段
        const screenshots = [];
        
        // 逐片段截取
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const scrollX = col * viewportWidth;
                const scrollY = row * viewportHeight;
                
                // 滚动到指定位置
                await chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    function: scrollToPosition,
                    args: [scrollX, scrollY]
                });
                
                // 等待滚动完成和页面稳定
                await new Promise(resolve => setTimeout(resolve, 300));
                
                // 截取当前可见区域，添加重试机制
                const dataUrl = await captureWithRetry(tabId);
                
                screenshots.push({
                    dataUrl,
                    x: scrollX,
                    y: scrollY,
                    row,
                    col
                });
            }
        }
        
        // 将所有片段合并成完整截图
        const fullScreenshotDataUrl = await mergeScreenshots(screenshots, {
            scrollWidth,
            scrollHeight,
            viewportWidth,
            viewportHeight,
            rows,
            cols
        });
        
        // 下载合并后的截图
        await downloadImage(fullScreenshotDataUrl, 'full');
        
        // 恢复页面滚动位置
        await chrome.scripting.executeScript({
            target: { tabId: tabId },
            function: scrollToPosition,
            args: [0, 0]
        });
        
        return { success: true };
        
    } catch (error) {
        console.error('Capture full page error:', error);
        return { success: false, error: error.message };
    }
}

// 注入到页面的函数：获取页面尺寸
function getPageDimensions() {
    // 强制刷新页面布局
    document.body.offsetHeight;
    
    const scrollWidth = Math.max(
        document.body.scrollWidth || 0,
        document.documentElement.scrollWidth || 0,
        document.body.offsetWidth || 0,
        document.documentElement.offsetWidth || 0,
        document.body.clientWidth || 0,
        document.documentElement.clientWidth || 0
    );
    
    const scrollHeight = Math.max(
        document.body.scrollHeight || 0,
        document.documentElement.scrollHeight || 0,
        document.body.offsetHeight || 0,
        document.documentElement.offsetHeight || 0,
        document.body.clientHeight || 0,
        document.documentElement.clientHeight || 0
    );
    
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    console.log('页面尺寸详情:', {
        'body.scrollWidth': document.body.scrollWidth,
        'documentElement.scrollWidth': document.documentElement.scrollWidth,
        'body.offsetWidth': document.body.offsetWidth,
        'documentElement.offsetWidth': document.documentElement.offsetWidth,
        '最终scrollWidth': scrollWidth,
        '最终scrollHeight': scrollHeight,
        'viewportWidth': viewportWidth,
        'viewportHeight': viewportHeight
    });
    
    return {
        scrollWidth,
        scrollHeight,
        viewportWidth,
        viewportHeight
    };
}

// 注入到页面的函数：滚动到指定位置
function scrollToPosition(x, y) {
    // 多种方式尝试滚动，确保兼容性
    window.scrollTo(x, y);
    document.documentElement.scrollLeft = x;
    document.documentElement.scrollTop = y;
    document.body.scrollLeft = x;
    document.body.scrollTop = y;
    
    // 强制刷新
    document.body.offsetHeight;
    
    const actualX = window.pageXOffset || document.documentElement.scrollLeft || document.body.scrollLeft || 0;
    const actualY = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
    
    const maxScrollX = Math.max(
        (document.body.scrollWidth || 0) - window.innerWidth,
        (document.documentElement.scrollWidth || 0) - window.innerWidth,
        0
    );
    const maxScrollY = Math.max(
        (document.body.scrollHeight || 0) - window.innerHeight,
        (document.documentElement.scrollHeight || 0) - window.innerHeight,
        0
    );
    
    console.log(`滚动: 目标(${x}, ${y}) -> 实际(${actualX}, ${actualY}), 最大滚动(${maxScrollX}, ${maxScrollY})`);
    
    return {
        targetX: x,
        targetY: y,
        actualX,
        actualY,
        maxScrollX,
        maxScrollY
    };
}

// 带重试机制的截图函数
async function captureWithRetry(tabId, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            // 在每次尝试之间添加延迟，避免触发API限制
            if (i > 0) {
                await new Promise(resolve => setTimeout(resolve, 1000 + i * 500));
            }
            
            const dataUrl = await chrome.tabs.captureVisibleTab();
            return dataUrl;
        } catch (error) {
            console.warn(`截图尝试 ${i + 1} 失败:`, error.message);
            
            if (error.message.includes('MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND')) {
                // 如果是限流错误，等待更长时间
                if (i < maxRetries - 1) {
                    await new Promise(resolve => setTimeout(resolve, 2000 + i * 1000));
                    continue;
                }
            }
            
            if (i === maxRetries - 1) {
                throw error;
            }
        }
    }
}

// 优化的整页截图函数，减少API调用频率
async function captureFullPageOptimized(tabId) {
    try {
        // 注入脚本获取页面完整尺寸
        const [result] = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            function: getPageDimensions
        });
        
        const { scrollWidth, scrollHeight, viewportWidth, viewportHeight } = result.result;
        
        console.log(`页面完整尺寸: ${scrollWidth}x${scrollHeight}, 视口尺寸: ${viewportWidth}x${viewportHeight}`);
        
        // 首先滚动到页面顶部，确保从(0,0)开始截图
        await chrome.scripting.executeScript({
            target: { tabId: tabId },
            function: scrollToPosition,
            args: [0, 0]
        });
        
        // 等待滚动完成
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // 如果页面没有滚动内容，直接截取可见区域
        if (scrollWidth <= viewportWidth && scrollHeight <= viewportHeight) {
            const dataUrl = await captureWithRetry(tabId);
            await downloadImage(dataUrl, 'full');
            return { success: true };
        }
        
        // 计算需要截取的片段数量
        const cols = Math.ceil(scrollWidth / viewportWidth);
        const rows = Math.ceil(scrollHeight / viewportHeight);
        const totalSegments = cols * rows;
        
        // 限制最大片段数以避免过多API调用
        const maxSegments = 25;
        if (totalSegments > maxSegments) {
            throw new Error(`页面过大，需要 ${totalSegments} 个片段，超过限制 ${maxSegments}。请尝试缩小浏览器窗口或使用可视区域截图。`);
        }
        
        console.log(`页面尺寸: ${scrollWidth}x${scrollHeight}, 视口: ${viewportWidth}x${viewportHeight}`);
        console.log(`需要截取 ${rows} 行 x ${cols} 列 = ${totalSegments} 个片段`);
        
        // 检查是否需要横向滚动
        if (cols > 1) {
            console.log(`页面需要横向滚动，宽度超出视口: ${scrollWidth} > ${viewportWidth}`);
        }
        
        // 存储所有截图片段
        const screenshots = [];
        
        // 逐片段截取，增加延迟避免API限制
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const scrollX = col * viewportWidth;
                const scrollY = row * viewportHeight;
                
                console.log(`截取片段 ${row * cols + col + 1}/${totalSegments}: 滚动到 (${scrollX}, ${scrollY}), 行${row}/列${col}`);
                
                // 滚动到指定位置
                const [scrollResult] = await chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    function: scrollToPosition,
                    args: [scrollX, scrollY]
                });
                
                const scrollInfo = scrollResult.result;
                console.log(`滚动信息:`, scrollInfo);
                
                // 等待页面稳定
                await new Promise(resolve => setTimeout(resolve, 400));
                
                // 截取当前可见区域，使用重试机制
                const dataUrl = await captureWithRetry(tabId);
                
                // 同时保存目标位置和实际位置
                screenshots.push({
                    dataUrl,
                    x: scrollInfo.actualX,
                    y: scrollInfo.actualY,
                    row,
                    col,
                    targetX: scrollX,
                    targetY: scrollY,
                    segmentIndex: row * cols + col
                });
                
                console.log(`完成片段 ${row * cols + col + 1}/${totalSegments}`);
                
                // 在片段之间添加延迟，避免API限制
                if (row * cols + col < rows * cols - 1) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }
        }
        
        // 将所有片段合并成完整截图
        const fullScreenshotDataUrl = await mergeScreenshots(screenshots, {
            scrollWidth,
            scrollHeight,
            viewportWidth,
            viewportHeight,
            rows,
            cols
        });
        
        // 下载合并后的截图
        await downloadImage(fullScreenshotDataUrl, 'full');
        
        // 恢复页面滚动位置
        await chrome.scripting.executeScript({
            target: { tabId: tabId },
            function: scrollToPosition,
            args: [0, 0]
        });
        
        return { success: true };
        
    } catch (error) {
        console.error('Capture full page optimized error:', error);
        return { success: false, error: error.message };
    }
}

// 合并截图片段 - 使用OffscreenCanvas和createImageBitmap
async function mergeScreenshots(screenshots, dimensions) {
    try {
        const canvas = new OffscreenCanvas(dimensions.scrollWidth, dimensions.scrollHeight);
        const ctx = canvas.getContext('2d');
        
        console.log(`创建画布: ${dimensions.scrollWidth}x${dimensions.scrollHeight}`);
        console.log(`共有 ${screenshots.length} 个截图片段需要合并`);
        
        // 按顺序处理每个截图片段
        for (let i = 0; i < screenshots.length; i++) {
            const screenshot = screenshots[i];
            try {
                // 将base64转换为blob
                const response = await fetch(screenshot.dataUrl);
                const blob = await response.blob();
                
                // 创建ImageBitmap
                const imageBitmap = await createImageBitmap(blob);
                // 计算实际绘制尺寸和位置 - 确保片段完全覆盖
                let drawWidth, drawHeight, destX, destY;
                
                // 始终使用目标位置进行拼接，确保网格对齐
                destX = screenshot.targetX !== undefined ? screenshot.targetX : screenshot.x;
                destY = screenshot.targetY !== undefined ? screenshot.targetY : screenshot.y;
                
                // 计算这个片段应该绘制的完整尺寸
                drawWidth = dimensions.viewportWidth;
                drawHeight = dimensions.viewportHeight;
                
                // 如果是最右侧片段，可能需要调整宽度
                if (destX + dimensions.viewportWidth > dimensions.scrollWidth) {
                    drawWidth = dimensions.scrollWidth - destX;
                }
                
                // 如果是最底部片段，可能需要调整高度
                if (destY + dimensions.viewportHeight > dimensions.scrollHeight) {
                    drawHeight = dimensions.scrollHeight - destY;
                }
                
                // 确保尺寸为正数
                drawWidth = Math.max(0, drawWidth);
                drawHeight = Math.max(0, drawHeight);
                
                console.log(`片段 ${i+1}: 绘制位置(${destX}, ${destY}), 实际滚动(${screenshot.x}, ${screenshot.y}), 目标滚动(${screenshot.targetX}, ${screenshot.targetY}), 绘制尺寸(${drawWidth}x${drawHeight})`);
                
                // 确保绘制参数有效
                if (drawWidth > 0 && drawHeight > 0 && destX >= 0 && destY >= 0) {
                    
                    // 使用完整的视口尺寸进行绘制，不裁剪源图像
                    // 这样确保右侧和底部的内容不会被遗漏
                    ctx.drawImage(
                        imageBitmap,
                        0, 0, imageBitmap.width, imageBitmap.height, // source: 使用完整源图像
                        destX, destY, drawWidth, drawHeight // destination: 按计算的尺寸绘制
                    );
                    
                    console.log(`✓ 成功绘制片段 ${i+1}: 源图像(${imageBitmap.width}x${imageBitmap.height}) -> 目标(${destX}, ${destY}, ${drawWidth}x${drawHeight})`);
                } else {
                    console.warn(`❌ 片段 ${i+1} 参数无效，跳过绘制:`, {
                        destX, destY, drawWidth, drawHeight,
                        scrollWidth: dimensions.scrollWidth,
                        scrollHeight: dimensions.scrollHeight,
                        'destX < scrollWidth': destX < dimensions.scrollWidth,
                        'destY < scrollHeight': destY < dimensions.scrollHeight
                    });
                }
                
                // 释放ImageBitmap内存
                imageBitmap.close();
                
            } catch (error) {
                console.error(`处理截图片段 ${i+1} 失败:`, error);
            }
        }
        
        // 转换为blob并返回data URL
        const blob = await canvas.convertToBlob({ type: 'image/png' });
        
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        });
        
    } catch (error) {
        console.error('合并截图失败:', error);
        throw error;
    }
}

// 下载图片
async function downloadImage(dataUrl, type) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `screenshot-${type}-${timestamp}.png`;
    
    await chrome.downloads.download({
        url: dataUrl,
        filename: filename,
        saveAs: false
    });
}