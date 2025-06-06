// Content Script - 在网页中运行的脚本

// 监听来自 popup 或 background 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getPageInfo') {
        sendResponse({
            url: window.location.href,
            title: document.title,
            dimensions: getPageDimensions()
        });
    }
    
    if (request.action === 'scrollToPosition') {
        window.scrollTo(request.x, request.y);
        sendResponse({ success: true });
    }
    
    if (request.action === 'getScrollPosition') {
        sendResponse({
            x: window.pageXOffset || document.documentElement.scrollLeft,
            y: window.pageYOffset || document.documentElement.scrollTop
        });
    }
});

// 获取页面完整尺寸的辅助函数
function getPageDimensions() {
    const body = document.body;
    const html = document.documentElement;
    
    return {
        scrollWidth: Math.max(
            body.scrollWidth,
            html.scrollWidth,
            body.offsetWidth,
            html.offsetWidth,
            body.clientWidth,
            html.clientWidth
        ),
        scrollHeight: Math.max(
            body.scrollHeight,
            html.scrollHeight,
            body.offsetHeight,
            html.offsetHeight,
            body.clientHeight,
            html.clientHeight
        ),
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio || 1
    };
}

// 添加一些实用工具函数
const ScreenshotUtils = {
    // 隐藏固定定位的元素（如导航栏、工具栏）
    hideFixedElements() {
        const fixedElements = [];
        const allElements = document.querySelectorAll('*');
        
        allElements.forEach(el => {
            const style = window.getComputedStyle(el);
            if (style.position === 'fixed' || style.position === 'sticky') {
                fixedElements.push({
                    element: el,
                    originalDisplay: style.display,
                    originalVisibility: style.visibility
                });
                el.style.display = 'none';
            }
        });
        
        return fixedElements;
    },
    
    // 恢复被隐藏的固定定位元素
    restoreFixedElements(fixedElements) {
        fixedElements.forEach(({ element, originalDisplay, originalVisibility }) => {
            element.style.display = originalDisplay;
            element.style.visibility = originalVisibility;
        });
    },
    
    // 移除可能干扰截图的元素
    hideInterferenceElements() {
        const selectors = [
            '[data-tooltip]',
            '.tooltip',
            '.popover',
            '.dropdown-menu.show',
            '.modal.show',
            '.notification',
            '.alert-overlay'
        ];
        
        const hiddenElements = [];
        
        selectors.forEach(selector => {
            const elements = document.querySelectorAll(selector);
            elements.forEach(el => {
                const originalDisplay = window.getComputedStyle(el).display;
                if (originalDisplay !== 'none') {
                    hiddenElements.push({
                        element: el,
                        originalDisplay: originalDisplay
                    });
                    el.style.display = 'none';
                }
            });
        });
        
        return hiddenElements;
    },
    
    // 恢复被隐藏的干扰元素
    restoreInterferenceElements(hiddenElements) {
        hiddenElements.forEach(({ element, originalDisplay }) => {
            element.style.display = originalDisplay;
        });
    }
};

// 监听页面滚动事件，确保截图时页面已稳定
let scrollTimeout;
function onScroll() {
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
        // 页面滚动稳定后的处理
        document.dispatchEvent(new CustomEvent('scrollStable'));
    }, 100);
}

// 等待页面滚动稳定
function waitForScrollStable() {
    return new Promise(resolve => {
        const handler = () => {
            document.removeEventListener('scrollStable', handler);
            resolve();
        };
        document.addEventListener('scrollStable', handler);
        
        // 如果没有滚动事件，直接触发
        setTimeout(() => {
            document.dispatchEvent(new CustomEvent('scrollStable'));
        }, 50);
    });
}

window.addEventListener('scroll', onScroll, { passive: true });

// 导出工具函数供其他脚本使用
window.ScreenshotUtils = ScreenshotUtils;
window.waitForScrollStable = waitForScrollStable;