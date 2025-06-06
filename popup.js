// 状态管理
const statusEl = document.getElementById('status');

function showStatus(message, type = 'loading') {
    statusEl.textContent = message;
    statusEl.className = `status ${type}`;
    statusEl.classList.remove('hidden');
}

function hideStatus() {
    statusEl.classList.add('hidden');
}

// 截图功能
document.getElementById('fullScreenshot').addEventListener('click', async () => {
    try {
        showStatus('正在截取整页...', 'loading');
        
        // 获取当前活动标签页
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        // 发送消息到 background script 执行整页截图
        const response = await chrome.runtime.sendMessage({
            action: 'captureFullPage',
            tabId: tab.id
        });
        
        if (response.success) {
            showStatus('截图已保存到下载文件夹', 'success');
            setTimeout(hideStatus, 3000);
        } else {
            throw new Error(response.error || '截图失败');
        }
        
    } catch (error) {
        console.error('Full screenshot error:', error);
        showStatus(`截图失败: ${error.message}`, 'error');
        setTimeout(hideStatus, 5000);
    }
});

document.getElementById('visibleScreenshot').addEventListener('click', async () => {
    try {
        showStatus('正在截取可视区域...', 'loading');
        
        // 获取当前活动标签页
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        // 添加延迟避免频率限制
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // 直接截取可见区域
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
            format: 'png',
            quality: 100
        });
        
        // 下载截图
        const filename = `screenshot-visible-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
        
        await chrome.downloads.download({
            url: dataUrl,
            filename: filename,
            saveAs: false
        });
        
        showStatus('可视区域截图已保存', 'success');
        setTimeout(hideStatus, 3000);
        
    } catch (error) {
        console.error('Visible screenshot error:', error);
        showStatus(`截图失败: ${error.message}`, 'error');
        setTimeout(hideStatus, 5000);
    }
});

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    // 检查是否在有效页面上
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const currentTab = tabs[0];
        if (currentTab.url.startsWith('chrome://') || 
            currentTab.url.startsWith('chrome-extension://') ||
            currentTab.url.startsWith('edge://') ||
            currentTab.url.startsWith('about:')) {
            showStatus('无法在此页面截图', 'error');
            document.getElementById('fullScreenshot').disabled = true;
            document.getElementById('visibleScreenshot').disabled = true;
        }
    });
});