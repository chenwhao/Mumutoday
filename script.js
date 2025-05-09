// --- DOM 元素引用 ---
const definitionTextElement = document.getElementById('definition-text');
const currentAnswerElement = document.getElementById('current-answer');
const jumbledLettersElement = document.getElementById('jumbled-letters');
const feedbackTextElement = document.getElementById('feedback-text');
const hintButton = document.getElementById('hint-button');
const pronounceButton = document.getElementById('pronounce-button');
const nextWordButton = document.getElementById('next-word-button');

const progressCircleElement = document.getElementById('progress-circle');
const progressMasteredElement = document.getElementById('progress-mastered');
const progressTotalElement = document.getElementById('progress-total');
const progressLabelElement = document.getElementById('progress-label');
const clearAttemptButton = document.getElementById('clear-attempt-button');
const skipButton = document.getElementById('skip-button'); 
// ▲▲▲ 添加到这里结束 ▲▲▲

// --- 全局变量 ---
let currentWord = null; // 存储当前单词的信息 (包括 ID, 英文, 中文)
let userAttemptArr = []; // 存储用户当前拼写的字母数组
let incorrectAttempts = 0; // 记录当前单词的错误次数 (用于提示等)
let currentMode = 'new'; // 默认模式是 'new'
let sessionIdsString = null; // 用于存储从 URL 获取的 session 单词 ID 字符串

// --- 函数：初始化游戏模式并获取第一个单词 ---
async function initializeGame() {
    console.log("初始化游戏...");
    const urlParams = new URLSearchParams(window.location.search);
    const modeParam = urlParams.get('mode');
    const idsParam = urlParams.get('ids');

    // 优先处理 URL 参数指定的模式
    if (modeParam === 'session' && idsParam) {
        currentMode = 'session';
        sessionIdsString = idsParam;
        console.log(`启动 Session 模式 (来自 URL 参数)，单词 IDs: ${sessionIdsString}`);
    } else if (modeParam === 'review') {
         currentMode = 'review';
         sessionIdsString = null; 
         console.log("启动 Review 模式 (来自 URL 参数)");
    } else if (modeParam === 'new') {
         currentMode = 'new';
         sessionIdsString = null;
         console.log("启动 New 模式 (来自 URL 参数)");
    } else {
        // 如果 URL 没有指定有效模式，则尝试从后端加载保存的练习列表
        console.log("URL 未指定模式，尝试从后端获取默认练习列表...");
        try {
            // 调用我们之前创建的获取当前选择列表的 API
            const response = await fetch('/api/session/current'); 

            if (response.ok) {
                const data = await response.json(); // 应该返回 { selected_ids: [...] }
                // 检查返回的数组是否有效且包含内容
                if (data.selected_ids && Array.isArray(data.selected_ids) && data.selected_ids.length > 0) {
                    // 如果后端有保存的列表，则将此列表设为当前 session
                    currentMode = 'session';
                    sessionIdsString = data.selected_ids.join(','); // 转为逗号分隔字符串
                    console.log(`使用后端保存的列表启动 Session 模式，单词 IDs: ${sessionIdsString}`);
                } else {
                    // 后端没有保存列表，或列表为空，则使用默认的 'new' 模式
                    currentMode = 'new';
                    sessionIdsString = null;
                    console.log("后端无有效保存列表，启动默认 New 模式");
                }
            } else {
                // 获取后端列表失败，也使用默认的 'new' 模式
                console.error('获取后端保存列表失败，状态码:', response.status, '，启动默认 New 模式');
                currentMode = 'new';
                sessionIdsString = null;
            }
        } catch (error) {
            // 网络错误等，也使用默认的 'new' 模式
            console.error('检查后端列表时发生网络错误，启动默认 New 模式:', error);
            currentMode = 'new';
            sessionIdsString = null;
        }
    }

    // 根据最终确定的模式，获取第一个单词并更新统计数据
    fetchNextWord();       
    updateProgressStats(); 
}


// --- 函数：获取下一个单词 ---
async function fetchNextWord() { 
    // ▲▲▲ 移除参数 ▲▲▲
    console.log(`正在获取下一个单词，模式: ${currentMode}`); // 使用全局变量 currentMode
    feedbackTextElement.textContent = '正在加载单词...';
    feedbackTextElement.className = 'feedback-loading'; 
    jumbledLettersElement.innerHTML = ''; 
    currentAnswerElement.textContent = ''; 
    nextWordButton.style.display = 'none'; 
    // 重新启用提示和发音按钮（如果之前被禁用）
    if (hintButton) { hintButton.style.display = 'inline-block'; hintButton.disabled = false; }
    if (pronounceButton) { pronounceButton.style.display = 'inline-block'; pronounceButton.disabled = false; }
    if (clearAttemptButton) { clearAttemptButton.style.display = 'inline-block'; clearAttemptButton.disabled = false; }
    if (skipButton) { skipButton.style.display = 'inline-block'; skipButton.disabled = false; }

    // 隐藏“下一个”按钮并移除特殊样式
    if (nextWordButton) {
        nextWordButton.style.display = 'none'; 
        nextWordButton.classList.remove('next-button-correct');
        nextWordButton.classList.remove('next-button-incorrect'); // 如果未来有错误样式的话
    }

    try {
        // ▼▼▼ 动态构建 API URL ▼▼▼
        let apiUrl = `/api/quiz/next?mode=${currentMode}`; // 基础 URL 带上当前模式
        if (currentMode === 'session' && sessionIdsString) {
            apiUrl += `&ids=${sessionIdsString}`; // 如果是 session 模式，添加 ids 参数
        }
        console.log("请求 API URL:", apiUrl); // 打印出请求的 URL 方便调试
        // ▲▲▲ 构建 URL 结束 ▲▲▲

        // ▼▼▼ 使用新的 apiUrl 进行 fetch ▼▼▼
        const response = await fetch(apiUrl); 
        // ▲▲▲ 使用新的 apiUrl ▲▲▲

        if (!response.ok) {
            if (response.status === 404) {
                const errorData = await response.json();
                feedbackTextElement.textContent = errorData.message || '没有更多单词了';
                feedbackTextElement.className = 'feedback-error';
                 // 没有单词了，禁用提示和发音按钮
                if(hintButton) hintButton.disabled = true;
                if(pronounceButton) pronounceButton.disabled = true;
            } else {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            currentWord = null; 
            return; 
        }

        const wordData = await response.json();
        currentWord = wordData; 
        console.log('获取到单词:', currentWord);
        definitionTextElement.textContent = currentWord.chinese_definition;
        displayJumbledLetters(currentWord.english_word); 
        updateAnswerDisplay([]); 
        userAttemptArr = [];
        incorrectAttempts = 0; 
        feedbackTextElement.textContent = '\u00A0'; 
        feedbackTextElement.className = '';

    } catch (error) {
        console.error('获取单词失败:', error);
        feedbackTextElement.textContent = '加载单词失败，请稍后重试。';
        feedbackTextElement.className = 'feedback-error';
        currentWord = null;
         // 出错也禁用按钮
        if(hintButton) hintButton.disabled = true;
        if(pronounceButton) pronounceButton.disabled = true;
    }
}

// --- 函数：显示打乱的字母 (保留原始大小写) ---
function displayJumbledLetters(word) { // word 是从后端获取的，包含原始大小写
    console.log("正在显示打乱的字母 for:", word);
    jumbledLettersElement.innerHTML = ''; // 清空之前的字母按钮

    // 1. 直接拆分单词为字母数组，【不】转换大小写，保留原始大小写
    const letters = word.split(''); 

    // 2. 打乱包含原始大小写的字母数组
    const shuffledLetters = letters.sort(() => 0.5 - Math.random());

    // 3. 为每个字母（保持原始大小写）创建按钮
    shuffledLetters.forEach(letter => {
        const button = document.createElement('button');
        // ▼▼▼ 直接使用 letter (包含原始大小写) 作为按钮文本 ▼▼▼
        button.textContent = letter; 
        // ▲▲▲ 修改结束 ▲▲▲

        // 检查字母是否为空白字符，如果是则禁用（虽然单词里一般没有）
        if (letter.trim() === '') {
             button.disabled = true;
             button.style.visibility = 'hidden'; // 可以隐藏空白字符按钮
        } else {
            button.addEventListener('click', handleLetterClick); // 添加点击事件监听器
        }
        jumbledLettersElement.appendChild(button);
    });
}

// --- 函数：更新答案显示区 ---
function updateAnswerDisplay(attemptArray) {
    if (currentWord) {
        let display = '';
        for (let i = 0; i < currentWord.english_word.length; i++) {
            // 如果尝试数组中有字母，显示字母，否则显示下划线
            display += (attemptArray[i] ? attemptArray[i] : '_') + ' '; 
        }
        // 去掉末尾多余的空格并更新到页面元素
        currentAnswerElement.textContent = display.trim(); 
    } else {
         currentAnswerElement.textContent = '_ _ _ _ _'; // 没有当前单词时的默认显示
    }
}

// --- 函数：处理字母按钮点击事件 ---
function handleLetterClick(event) {
    // 如果没有当前单词，或者答案已经满了，则不处理点击
    if (!currentWord || userAttemptArr.length >= currentWord.english_word.length) {
        return; 
    }

    const clickedLetter = event.target.textContent; // 获取按钮上的字母 (大写)

    // 1. 将点击的字母添加到用户尝试数组 (用小写存储)
    userAttemptArr.push(clickedLetter.toLowerCase());

    // 2. 更新答案区的显示
    updateAnswerDisplay(userAttemptArr);

    // 3. 禁用被点击的按钮，防止重复点击
    event.target.disabled = true; 

    // 4. 检查答案是否已经拼写完整
    if (userAttemptArr.length === currentWord.english_word.length) {
        console.log("答案已完整，准备提交:", userAttemptArr.join(''));
        // 答案长度足够，触发提交逻辑 (我们将在下一步实现 submitAnswer 函数)
        submitAnswer(); 
    }
}

// --- 函数：提交答案 (需要后续实现) ---
// --- 函数：提交答案 ---
async function submitAnswer() {
    const attempt = userAttemptArr.join(''); // ['b','a','n','a','n','a'] -> "banana"
    console.log(`提交答案: "${attempt}" for Word ID: ${currentWord.word_id}`);

    // 禁用所有字母按钮，防止重复提交或误触
    const letterButtons = jumbledLettersElement.querySelectorAll('button');
    letterButtons.forEach(button => button.disabled = true);
    if (clearAttemptButton) clearAttemptButton.disabled = true;
    if (skipButton) skipButton.disabled = true;

    // 显示"正在检查..."反馈
    feedbackTextElement.textContent = '正在检查答案...';
    feedbackTextElement.className = 'feedback-loading';

    try {
        // 1. 准备要发送给后端的数据
        const submissionData = {
            word_id: currentWord.word_id,
            user_attempt: attempt 
        };

        // 2. 调用后端的 /api/quiz/submit 接口
        const response = await fetch('/api/quiz/submit', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json' // 告诉后端我们发送的是 JSON
            },
            body: JSON.stringify(submissionData) // 将 JavaScript 对象转换为 JSON 字符串
        });

        // 3. 检查后端是否成功处理请求 (HTTP 状态码 200-299 算成功)
        if (!response.ok) {
            // 如果后端返回错误状态码 (如 400, 404, 500)
            let errorMsg = `提交失败，服务器状态码: ${response.status}`;
            try {
                // 尝试解析后端可能返回的错误信息 JSON
                const errorData = await response.json();
                errorMsg = errorData.message || errorMsg; 
            } catch (parseError) {
                // 解析错误信息失败，使用原始状态码信息
            }
            throw new Error(errorMsg); // 抛出错误，会被下面的 catch 捕获
        }

        // 4. 解析后端返回的 JSON 结果
        const result = await response.json(); // result 应该包含 { correct: true/false, correct_spelling: "..." }


        // 5. 根据结果显示反馈信息并调整按钮显隐和样式
        if (result.correct) {
            feedbackTextElement.textContent = "正确！";
            feedbackTextElement.className = 'feedback-correct';

            // 答对时：隐藏其他按钮，显示并突出“下一个”按钮
            if (hintButton) hintButton.style.display = 'none';
            if (pronounceButton) pronounceButton.style.display = 'none';
            if (clearAttemptButton) clearAttemptButton.style.display = 'none';
            if (skipButton) skipButton.style.display = 'none';

            if (nextWordButton) {
                nextWordButton.style.display = 'inline-block'; // 显示
                nextWordButton.classList.add('next-button-correct'); // 添加特殊样式类 (绿色)
                nextWordButton.classList.remove('next-button-incorrect'); // 移除可能存在的错误样式（如果有的话）
            }

        } else {
            feedbackTextElement.textContent = `错误！正确答案是: ${result.correct_spelling}`; 
            feedbackTextElement.className = 'feedback-incorrect';

            // 答错时：也隐藏其他按钮，只显示“下一个”按钮（使用默认样式）
            if (hintButton) hintButton.style.display = 'none';
            if (pronounceButton) pronounceButton.style.display = 'none';
            if (clearAttemptButton) clearAttemptButton.style.display = 'none';
            if (skipButton) skipButton.style.display = 'none';

            if (nextWordButton) {
                nextWordButton.style.display = 'inline-block'; // 显示
                // 确保移除特殊样式，恢复默认
                nextWordButton.classList.remove('next-button-correct'); 
                nextWordButton.classList.remove('next-button-incorrect'); 
            }
        }

        // 6. 更新学习统计 (这行保持不变)
        updateProgressStats(); 

    // ... (try 块结束) ...
        // 6. 显示“下一个”按钮，让用户可以继续
        nextWordButton.style.display = 'inline-block';

        // 7. 更新学习统计 <<-- 添加这一行
        updateProgressStats(); 
        // ... (try 块结束) ...

    } catch (error) {
        // 处理 fetch 调用本身失败 (如网络错误) 或上面抛出的错误
        console.error('提交答案时出错:', error);
        feedbackTextElement.textContent = `错误: ${error.message}`;
        feedbackTextElement.className = 'feedback-error';
        // 即使提交出错，也可能需要允许用户继续下一个？或者提示刷新？暂时先显示按钮
        nextWordButton.style.display = 'inline-block';
    }
}

// --- 函数：获取并更新学习统计 (圆形进度条 - 统一逻辑版) ---
async function updateProgressStats() {
    console.log("正在更新学习统计 (圆形)...");
    if (!progressCircleElement || !progressMasteredElement || !progressTotalElement || !progressLabelElement) {
        console.error("更新统计时缺少必要的进度条 DOM 元素");
        return;
    }

    try {
        // 1. 构建 API 请求 URL (如果是 session 模式，带上 ids 参数)
        let apiUrl = '/api/progress/stats';
        if (currentMode === 'session' && sessionIdsString) {
            apiUrl += `?ids=${sessionIdsString}`;
        }
        console.log("请求统计 API URL:", apiUrl);

        const response = await fetch(apiUrl); 
        if (!response.ok) {
             let errorMsg = `获取统计失败: ${response.status}`;
             try{ const errData = await response.json(); errorMsg = errData.message || errorMsg; } catch(e){}
            throw new Error(errorMsg);
        }
        const stats = await response.json(); // 获取所有统计数据
        // stats 包含: { total, mastered, session_total, session_mastered }

        let numerator, denominator; // 定义分子和分母

        // 2. 根据当前模式决定使用哪些数据
        if (currentMode === 'session' && stats.session_total !== null) {
            // Session 模式：使用 session 内的数据
            numerator = stats.session_mastered;
            denominator = stats.session_total;
            console.log(`Session 模式统计：掌握 ${numerator} / 总共 ${denominator}`);
        } else {
            // 默认模式 (new, review, 或 session ids 无效时): 使用全局数据
            numerator = stats.mastered;
            denominator = stats.total;
            console.log(`全局模式统计：掌握 ${numerator} / 总共 ${denominator}`);
        }

         // 确保分子或分母无效时给默认值 0
         numerator = Number(numerator) || 0;
         denominator = Number(denominator) || 0;


        // 3. 计算百分比
        let percentage = 0;
        if (denominator > 0) {
            percentage = (numerator / denominator) * 100;
        }
        percentage = Math.max(0, Math.min(100, percentage)); // 确保在 0-100 之间
        const percentageText = percentage.toFixed(1);

        // 4. 更新圆环中间的数字
        progressMasteredElement.textContent = numerator;
        progressTotalElement.textContent = denominator;

        // 5. 更新下方的百分比文字
        progressLabelElement.textContent = `掌握率: ${percentageText}%`;

        // 6. 更新 CSS 变量驱动圆环显示
        progressCircleElement.style.setProperty('--progress-percent', percentageText + '%');

        console.log(`学习统计已更新: 显示 <span class="math-inline">\{numerator\}/</span>{denominator}, 百分比 ${percentageText}%`);
        const statsSection = document.querySelector('.progress-stats');
        if (statsSection) statsSection.style.display = 'block'; 

    } catch (error) {
        console.error('更新学习统计时出错:', error);
        progressMasteredElement.textContent = 'ERR';
        progressTotalElement.textContent = 'N/A';
        progressLabelElement.textContent = '加载失败';
        progressCircleElement.style.setProperty('--progress-percent', '0%'); 
    }
}

// --- 函数：处理提示按钮点击事件 ---
function handleHint() {
    if (!currentWord) {
        feedbackTextElement.textContent = '请先加载一个单词';
        feedbackTextElement.className = 'feedback-error';
        return;
    }

    // 显示正确答案
    const correctAnswer = currentWord.english_word;
    feedbackTextElement.textContent = `提示: ${correctAnswer}`;
    feedbackTextElement.className = 'feedback-hint'; // 可以用 CSS 给提示加特殊样式

    // 设置一个定时器，3秒后清除提示信息
    setTimeout(() => {
        // 检查当前反馈区域的内容是否还是刚才的提示，避免清除掉后续的正确/错误信息
        if (feedbackTextElement.textContent === `提示: ${correctAnswer}`) {
            feedbackTextElement.textContent = '\u00A0'; // 用空格占位
            feedbackTextElement.className = ''; // 清除特殊样式
        }
    }, 3000); // 3000毫秒 = 3秒
}

// --- 函数：处理发音按钮点击事件 ---
function handlePronounce() {
    if (!currentWord) {
        alert('请先加载一个单词'); // 简单提示
        return;
    }

    // 检查浏览器是否支持语音合成 API
    if ('speechSynthesis' in window) {
        // 创建一个语音合成实例，内容为当前英文单词
        const utterance = new SpeechSynthesisUtterance(currentWord.english_word);

        // **重要：设置语言为英语** (否则可能用系统默认语言读)
        utterance.lang = 'en-US'; // 美国英语，也可以试试 'en-GB' 英国英语

        // (可选) 调整语速和音调
        // utterance.rate = 1; // 语速，默认 1
        // utterance.pitch = 1; // 音调，默认 1

        // 让浏览器朗读出来
        window.speechSynthesis.speak(utterance);
    } else {
        // 如果浏览器不支持，给个提示
        alert('抱歉，你的浏览器不支持语音朗读功能。');
    }
}

// --- 函数：处理清空重输按钮点击 ---
function handleClearAttempt() {
    // 检查是否有当前单词，以及答案区是否已经有字母（否则没必要清空）
    if (!currentWord || userAttemptArr.length === 0) {
        return; 
    }

    console.log("清空当前尝试");

    // 1. 清空用户已输入的字母数组
    userAttemptArr = []; 

    // 2. 更新答案区的显示（变回全部下划线）
    updateAnswerDisplay(userAttemptArr); 

    // 3. 重新启用所有在字母区的按钮
    const letterButtons = jumbledLettersElement.querySelectorAll('button');
    letterButtons.forEach(button => {
        button.disabled = false; // 将每个按钮的 disabled 状态设为 false
    });

    // 4. 清空可能的反馈信息
    feedbackTextElement.textContent = '\u00A0'; 
    feedbackTextElement.className = '';

    // 5. 确保“下一个”按钮是隐藏的（因为重新开始拼写了）
     nextWordButton.style.display = 'none';
}

// --- 页面加载时自动获取第一个单词和统计 ---
document.addEventListener('DOMContentLoaded', () => {
    initializeGame(); 
});

// --- 事件监听器 (需要后续添加) ---
hintButton.addEventListener('click', handleHint);
pronounceButton.addEventListener('click', handlePronounce);
nextWordButton.addEventListener('click', () => fetchNextWord()); 
if (clearAttemptButton) { 
    clearAttemptButton.addEventListener('click', handleClearAttempt);
}
if (skipButton) { // 检查按钮是否存在
    skipButton.addEventListener('click', () => {
        console.log("用户跳过当前单词");
        // 直接获取下一个单词，使用当前的 mode 和 sessionIds (如果存在)
        fetchNextWord(); 
    });
}