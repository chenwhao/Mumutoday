document.addEventListener('DOMContentLoaded', () => {
    // --- 获取 DOM 元素 ---
    const addForm = document.getElementById('add-word-form');
    const wordListBody = document.getElementById('word-list-body');
    const addErrorMessageElement = document.getElementById('add-error-message');
    const listErrorMessageElement = document.getElementById('list-error-message');
    const englishWordInput = document.getElementById('english-word');
    const chineseDefinitionInput = document.getElementById('chinese-definition');

    const startSessionButton = document.getElementById('start-session-button');
    const selectAllCheckbox = document.getElementById('select-all-checkbox');
    const selectedCountElement = document.getElementById('selected-count');

    const exportButton = document.getElementById('export-csv-button');
    const importForm = document.getElementById('import-csv-form');
    const csvFileInput = document.getElementById('csv-file-input');
    const importStatusMessageElement = document.getElementById('import-status-message');
   

   const filterWeekTagInput = document.getElementById('filter-week-tag');
   const filterButton = document.getElementById('filter-button');
   const clearFilterButton = document.getElementById('clear-filter-button');

    // --- 辅助函数：转义 HTML (防止 XSS 攻击) ---
    function escapeHTML(str) {
        if (!str) return '';
        // 替换 & < > " ' 等特殊字符
        return str.replace(/&/g, '&amp;')
                  .replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;')
                  .replace(/"/g, '&quot;')
                  .replace(/'/g, '&#039;');
    }



// --- 函数：更新“开始练习”按钮状态和计数 ---
    function updateSessionButtonState() {
        // 确保在 loadWords 之前或之后定义了 wordListBody, startSessionButton, selectedCountElement
        if (!wordListBody || !startSessionButton || !selectedCountElement) {
            console.warn("更新按钮状态时缺少必要元素引用");
            return; 
        }

        // 获取所有被选中的单词复选框
        const selectedCheckboxes = wordListBody.querySelectorAll('.word-checkbox:checked');
        const count = selectedCheckboxes.length;

        // 更新计数显示
        selectedCountElement.textContent = `已选: ${count} 个单词`;

        // 如果选中数量大于0，则启用按钮，否则禁用
        if (count > 0) {
            startSessionButton.disabled = false;
            startSessionButton.textContent = `用选中的 ${count} 个单词开始练习`;
            startSessionButton.style.backgroundColor = '#fd7e14'; // 恢复橙色
            startSessionButton.style.cursor = 'pointer';
        } else {
            startSessionButton.disabled = true;
            startSessionButton.textContent = '用选中单词开始练习 (请先选择)';
            startSessionButton.style.backgroundColor = '#aaa'; // 禁用时灰色
            startSessionButton.style.cursor = 'not-allowed';
        }

        // 更新全选框的状态
        const allCheckboxes = wordListBody.querySelectorAll('.word-checkbox');
        if(selectAllCheckbox){ 
            // indeterminate 状态表示部分选中
            selectAllCheckbox.indeterminate = count > 0 && count < allCheckboxes.length; 
            // 只有当所有复选框都存在且数量与选中数量一致时，全选框才完全选中
            selectAllCheckbox.checked = allCheckboxes.length > 0 && count === allCheckboxes.length;
        }
    }

    // --- 函数：将当前选中状态保存到后端 ---
    async function saveCurrentSelection() {
        // 确保元素存在
        if (!wordListBody || !listErrorMessageElement) { 
            console.error("保存选项时缺少必要元素");
            return;
        }

        // 1. 获取当前所有选中的复选框
        const selectedCheckboxes = wordListBody.querySelectorAll('.word-checkbox:checked');
        // 2. 提取它们的 word_id (value 属性)，并确保是数字
        const selectedIds = Array.from(selectedCheckboxes).map(cb => parseInt(cb.value, 10)); 

        console.log("准备保存选中列表到后端:", selectedIds);
        listErrorMessageElement.textContent = '正在保存选择...'; // 显示保存中提示
        listErrorMessageElement.style.color = '#6c757d'; // 灰色提示

        try {
            // 3. 调用后端的 PUT /api/session/current 接口
            const response = await fetch('/api/session/current', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                // 将 ID 数组包装在 { selected_ids: ... } 对象中，并转为 JSON 字符串
                body: JSON.stringify({ selected_ids: selectedIds }) 
            });

            const result = await response.json(); // 获取后端响应

            if (!response.ok) {
                // 如果后端返回错误，抛出错误以便被 catch 捕获
                throw new Error(result.message || `保存选中状态失败: ${response.status}`);
            }

            // 4. 保存成功
            console.log("后端保存选中状态成功:", result.message);
            listErrorMessageElement.textContent = '选择已保存!'; // 显示成功消息
            listErrorMessageElement.style.color = 'green'; // 绿色

            // 2秒后自动清除成功消息
            setTimeout(() => {
                // 检查是否仍然是保存成功的消息，避免清除掉后续可能出现的错误消息
                if (listErrorMessageElement.textContent === '选择已保存!') {
                    listErrorMessageElement.textContent = '\u00A0'; // 清空
                    listErrorMessageElement.style.color = ''; // 恢复默认颜色
                }
            }, 2000);

        } catch (error) {
            // 5. 处理错误
            console.error('保存选中状态到后端时出错:', error);
            listErrorMessageElement.textContent = `保存选择失败: ${error.message}`;
            listErrorMessageElement.style.color = 'red'; // 红色错误消息
        }
    }

   // --- 函数：加载并显示单词列表 (支持按 tag 筛选) ---
    async function loadWords(tag = null) { // 增加了 tag 参数，默认为 null
        console.log(`开始加载单词列表... ${tag ? `Tag: ${escapeHTML(tag)}` : '全部'}`);
        if (!listErrorMessageElement || !wordListBody) {
             console.error("loadWords 无法访问必要的 DOM 元素");
             return; 
        }
        
        listErrorMessageElement.textContent = '\u00A0'; 
        wordListBody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 20px;">正在加载...</td></tr>'; // colspan 改为 7

        try {
            let apiUrl = '/api/words';
            if (tag && tag.trim() !== '') {
                apiUrl += `?tag=${encodeURIComponent(tag.trim())}`; // 如果提供了 tag，则附加到 URL
            }

            const response = await fetch(apiUrl); 
            if (!response.ok) {
                let errorMsg = `获取列表失败: ${response.status}`;
                 try {
                    const errorData = await response.json(); 
                    errorMsg = errorData.message || errorMsg;
                 } catch(e) { /* 解析失败就算了 */ }
                throw new Error(errorMsg);
            }
            const words = await response.json();
            console.log("获取到单词:", words);

            wordListBody.innerHTML = ''; 

            if (words.length === 0) {
                const message = tag ? `没有找到标签为 "${escapeHTML(tag)}" 的单词。` : '单词库是空的，请添加单词。';
                wordListBody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 20px;">${message}</td></tr>`; // colspan 改为 7
                updateSessionButtonState(); 
                if(selectAllCheckbox) selectAllCheckbox.checked = false;
                return; 
            }

            // 遍历单词数据，创建表格行
            words.forEach(word => {
                const row = document.createElement('tr');
                row.dataset.wordId = word.word_id; 
                row.dataset.en = word.english_word;
                row.dataset.cn = word.chinese_definition;
                row.dataset.weekTag = word.week_tag || ''; // 保存 week_tag 到 dataset

                row.innerHTML = `
                    <td><input 
                            type="checkbox" 
                            class="word-checkbox" 
                            value="${word.word_id}" 
                            title="选择 ${escapeHTML(word.english_word)}" 
                            ${word.is_selected ? 'checked' : ''} 
                        ></td> 
                    <td>${word.word_id}</td>
                    <td class="word-en">${escapeHTML(word.english_word)}</td>
                    <td class="word-cn">${escapeHTML(word.chinese_definition)}</td>
                    <td class="word-week-tag">${escapeHTML(word.week_tag)}</td> 
                    <td class="word-status"> 
                        ${word.is_mastered === 1 ? '<span style="color: green; font-weight: bold;">已掌握</span>' : '<span style="color: orange;">未掌握</span>'}
                    </td>
                    <td class="actions">
                        <button class="edit-button" data-id="${word.word_id}">编辑</button>
                        <button class="delete-button" data-id="${word.word_id}">删除</button>
                        <button class="reset-progress-button" data-id="${word.word_id}" title="将此单词标记为未掌握">重置</button> 
                    </td>
                `;
                wordListBody.appendChild(row);
            }); 

            // 成功渲染完所有行并恢复选中后，更新按钮和全选框状态
            updateSessionButtonState(); 
            if(selectAllCheckbox) {
                 // 只有在没有筛选条件(即显示全部单词时)才根据当前页的选中情况决定全选框的打勾状态
                 // 如果有筛选条件，全选框不应该直接打勾，除非筛选出的所有项都被选中
                 // 为了简化，筛选时全选框先不打勾，即使所有筛选结果都被选中了
                 if (!tag || tag.trim() === '') {
                    const allVisibleCheckboxes = wordListBody.querySelectorAll('.word-checkbox');
                    const allVisibleChecked = Array.from(allVisibleCheckboxes).every(cb => cb.checked);
                    selectAllCheckbox.checked = allVisibleCheckboxes.length > 0 && allVisibleChecked;
                 } else {
                    selectAllCheckbox.checked = false; // 筛选时默认不勾选全选
                 }
                 selectAllCheckbox.indeterminate = false; // 先清除部分选中状态，updateSessionButtonState会重新计算
            }
            updateSessionButtonState(); // 确保在selectAllCheckbox状态更新后再调用一次，以正确设置indeterminate

        } catch (error) { 
            console.error('加载单词列表时出错:', error);
            listErrorMessageElement.textContent = `加载列表失败: ${error.message}`;
            wordListBody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 20px; color: red;">加载单词列表失败。</td></tr>'; // colspan 改为 7
            updateSessionButtonState(); 
            if(selectAllCheckbox) selectAllCheckbox.checked = false;
        }
    } // loadWords 函数结束

    
// --- 处理按标签筛选按钮点击 ---
    if (filterButton && filterWeekTagInput) {
        filterButton.addEventListener('click', () => {
            const tagToFilter = filterWeekTagInput.value.trim();
            if (tagToFilter) {
                console.log("按标签筛选:", tagToFilter);
                loadWords(tagToFilter); // 调用 loadWords 并传入标签
            } else {
                // 如果标签为空，可以提示用户输入，或者等同于显示全部
                loadWords(); // 或者 listErrorMessageElement.textContent = '请输入要筛选的标签';
            }
        });
    }

    // --- 处理清除筛选按钮点击 ---
    if (clearFilterButton && filterWeekTagInput) {
        clearFilterButton.addEventListener('click', () => {
            console.log("清除筛选，显示全部单词");
            filterWeekTagInput.value = ''; // 清空筛选输入框
            loadWords(); // 不带参数调用，加载全部
        });
    }

    // --- 处理导出按钮点击 ---
    if(exportButton) { // 检查按钮是否存在
        exportButton.addEventListener('click', () => {
            console.log("请求导出 CSV...");
            // 直接让浏览器导航到导出 API 的 URL
            // 后端会设置正确的响应头，浏览器会自动触发文件下载
            window.location.href = '/api/words/export'; 
        });
    }

    // --- 处理导入表单提交 ---
    if(importForm && csvFileInput && importStatusMessageElement) { // 检查元素是否存在
        importForm.addEventListener('submit', async (event) => {
            event.preventDefault(); // 阻止表单的默认提交刷新行为
            importStatusMessageElement.textContent = '\u00A0'; // 清空之前的状态消息
            importStatusMessageElement.style.color = ''; // 恢复默认颜色

            const file = csvFileInput.files[0]; // 获取用户选择的文件
            if (!file) {
                importStatusMessageElement.textContent = '错误：请先选择一个 CSV 文件！';
                importStatusMessageElement.style.color = 'red';
                return;
            }

            console.log(`准备上传文件: ${file.name}`);
            const importButton = importForm.querySelector('button[type="submit"]');
            importButton.disabled = true; // 禁用按钮防止重复提交
            importButton.textContent = '导入中...';

            // 使用 FormData 来包装文件数据以便上传
            const formData = new FormData();
            // 'csvfile' 这个名字必须和后端 server.js 里 multer 配置的 upload.single('csvfile') 一致
            formData.append('csvfile', file); 

            try {
                // 发送 POST 请求到导入 API
                const response = await fetch('/api/words/import', {
                    method: 'POST',
                    body: formData // 发送 FormData 时，浏览器会自动设置正确的 Content-Type (multipart/form-data)
                });

                const result = await response.json(); // 获取后端返回的 JSON 结果

                if (!response.ok) {
                    // 如果 HTTP 状态码不是 2xx，抛出错误，使用后端消息
                    throw new Error(result.message || `导入失败，状态码: ${response.status}`);
                }

                // 导入成功
                console.log("导入成功:", result);
                importStatusMessageElement.textContent = result.message; // 显示后端返回的成功消息
                importStatusMessageElement.style.color = 'green'; // 成功消息用绿色显示

                importForm.reset(); // 清空文件选择框

                loadWords(); // 重新加载单词列表以显示新导入的单词

            } catch (error) {
                // 处理 fetch 错误或上面抛出的错误
                console.error('导入 CSV 时出错:', error);
                importStatusMessageElement.textContent = `导入错误: ${error.message}`;
                importStatusMessageElement.style.color = 'red'; // 错误消息用红色显示
            } finally {
                importButton.disabled = false; // 无论成功或失败，最后都恢复按钮
                importButton.textContent = '导入选定文件';
            }
        });
    }

    // --- 处理添加单词表单提交 ---
    addForm.addEventListener('submit', async (event) => {
        event.preventDefault(); // 阻止表单默认的页面刷新行为
        addErrorMessageElement.textContent = '\u00A0'; // 清除旧错误

        const newWord = {
            english_word: englishWordInput.value.trim(),
            chinese_definition: chineseDefinitionInput.value.trim(),
            week_tag: weekTagInput.value.trim() || null
            // 获取例句等其他字段（如果添加了输入框）
            // example_sentence_en: document.getElementById('example-en').value.trim(),
        };

        if (!newWord.english_word || !newWord.chinese_definition) {
            addErrorMessageElement.textContent = '英文单词和中文释义不能为空！';
            return;
        }

        console.log("准备添加单词:", newWord);
        const addButton = addForm.querySelector('button[type="submit"]');
        addButton.disabled = true; // 防止重复提交
        addButton.textContent = '添加中...';

        try {
            const response = await fetch('/api/words', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newWord)
            });

            const result = await response.json(); // 尝试读取响应体

            if (!response.ok) {
                // 使用后端返回的错误消息（如果有的话）
                throw new Error(result.message || `添加失败: ${response.status}`);
            }
            
            console.log("添加成功:", result);
            englishWordInput.value = ''; // 清空表单
            chineseDefinitionInput.value = '';
            if (weekTagInput) weekTagInput.value = ''; 
            // 清空其他输入框...
            loadWords(); // 重新加载列表

        } catch (error) {
            console.error('添加单词时出错:', error);
            addErrorMessageElement.textContent = `${error.message}`;
        } finally {
             addButton.disabled = false; // 恢复按钮
             addButton.textContent = '添加单词';
        }
    });

        // --- 监听表格体内的变化 (用于更新按钮状态) ---
        if (wordListBody) { // 检查 wordListBody 是否存在
            wordListBody.addEventListener('change', (event) => {
                // 仅当是单词复选框状态改变时才更新
                if (event.target.matches('.word-checkbox')) {
                    updateSessionButtonState();
                    saveCurrentSelection(); 
                }
            });
        }

        // --- 处理“全选/全不选”复选框 ---
        if (selectAllCheckbox && wordListBody) { // 检查元素是否存在
            selectAllCheckbox.addEventListener('change', () => {
                const isChecked = selectAllCheckbox.checked;
                const allCheckboxes = wordListBody.querySelectorAll('.word-checkbox');
                allCheckboxes.forEach(checkbox => {
                    checkbox.checked = isChecked; // 将所有单词复选框设为与全选框一致
                });
                updateSessionButtonState(); // 更新计数和按钮状态
                saveCurrentSelection();
            });
        }

        // --- 处理“开始练习”按钮点击 ---
        if (startSessionButton && wordListBody) { // 检查元素是否存在
            startSessionButton.addEventListener('click', () => {
                // 查找所有在表格体中被选中的复选框
                const selectedCheckboxes = wordListBody.querySelectorAll('.word-checkbox:checked');
                const selectedIds = []; // 用于存储选中的 word_id

                // 遍历选中的复选框，获取它们的 value (即 word_id)
                selectedCheckboxes.forEach(checkbox => {
                    selectedIds.push(checkbox.value); 
                });

                // 检查是否至少选择了一个单词
                if (selectedIds.length > 0) {
                    const idsString = selectedIds.join(','); // 将 ID 数组用逗号连接成字符串
                    // 构造跳转 URL，根路径通常是 '/' 指向 index.html
                    const redirectUrl = `/?mode=session&ids=${idsString}`; 
                    console.log('准备跳转到:', redirectUrl);
                    window.location.href = redirectUrl; // 执行页面跳转
                } else {
                    // 一般不会执行到这里，因为按钮在未选中时是禁用的
                    alert('请至少选择一个单词！'); 
                }
            });
        }


    // --- 处理表格中的按钮点击 (使用事件委托) ---
    wordListBody.addEventListener('click', async (event) => {
        const target = event.target; // 获取被点击的具体元素
        const wordRow = target.closest('tr'); // 获取按钮所在的表格行

        // --- 处理删除按钮 ---
        if (target.matches('.delete-button')) {
            const wordId = target.dataset.id; // 获取 word_id
            const wordEn = wordRow ? wordRow.dataset.en : ''; // 从行数据获取英文单词

            console.log("请求删除 Word ID:", wordId);

            if (confirm(`确定要删除单词 "${wordEn}" (ID: ${wordId}) 吗？\n相关的学习进度也会被删除！`)) {
                listErrorMessageElement.textContent = '\u00A0'; 
                target.disabled = true; 
                target.textContent = '删除中...';

                try {
                    const response = await fetch(`/api/words/${wordId}`, { method: 'DELETE' });
                    const result = await response.json(); 

                    if (!response.ok) {
                         throw new Error(result.message || `删除失败: ${response.status}`);
                    }

                    console.log("删除成功:", result);
                    loadWords(); // 刷新列表

                } catch (error) {
                    console.error('删除单词时出错:', error);
                    listErrorMessageElement.textContent = `删除失败: ${error.message}`;
                    // 即使出错也尝试恢复按钮状态，以防万一
                    if(target.parentNode) { // 检查按钮是否还在DOM中
                       target.disabled = false; 
                       target.textContent = '删除';
                    }
                }
            }
        }

        // --- 处理编辑按钮 ---
        if (target.matches('.edit-button')) {
            if (!wordRow) return; // 如果找不到行，则退出
            const wordId = target.dataset.id;
            const currentEn = wordRow.dataset.en; // 从行数据获取当前值
            const currentCn = wordRow.dataset.cn;
            const currentTag = wordRow.dataset.weekTag; // 从 dataset 获取当前 week_tag
            console.log("请求编辑 Word ID:", wordId, "当前值:", currentEn, currentCn);

            const enCell = wordRow.querySelector('.word-en');
            const cnCell = wordRow.querySelector('.word-cn');
            const tagCell = wordRow.querySelector('.word-week-tag'); 
            const actionsCell = wordRow.querySelector('.actions');


            if(enCell && cnCell && tagCell && actionsCell){ 
                enCell.innerHTML = `<input type='text' class='edit-en' value='${escapeHTML(currentEn)}' style='width: 95%; padding: 5px;'>`;
                cnCell.innerHTML = `<input type='text' class='edit-cn' value='${escapeHTML(currentCn)}' style='width: 95%; padding: 5px;'>`;
                tagCell.innerHTML = `<input type='text' class='edit-tag' value='${escapeHTML(currentTag)}' style='width: 95%; padding: 5px;'>`; // ▼▼▼ 添加 week_tag 输入框 ▼▼▼

                actionsCell.innerHTML = `
                    <button class='save-button' data-id='<span class="math-inline">\{wordId\}'\>保存</button\>
                    <button class='cancel-button' data-id='{wordId}'>取消</button>`;
            }
        }

        // --- 处理保存按钮 ---
         if (target.matches('.save-button')) {
             if (!wordRow) return;
             const wordId = target.dataset.id;
             const newEnInput = wordRow.querySelector('.edit-en');
             const newCnInput = wordRow.querySelector('.edit-cn');
             const actionsCell = wordRow.querySelector('.actions'); // 获取按钮单元格引用
             const newTagInput = wordRow.querySelector('.edit-tag');

             
             const newEn = newEnInput.value.trim();
             const newCn = newCnInput.value.trim();
             const newTag = newTagInput ? newTagInput.value.trim() : null; // ▼▼▼ 获取新 tag ▼▼▼

             if (!newEnInput || !newCnInput || !actionsCell) return; // 确保元素存在

             if (!newEn || !newCn) {
                 listErrorMessageElement.textContent = '英文单词和中文释义不能为空！';
                 // 可以考虑给输入框加红色边框等提示
                 return;
             }
             
             const updatedWord = {
                    english_word: newEn,
                    chinese_definition: newCn,
                    week_tag: newTag // ▼▼▼ 添加新 tag 到请求体 ▼▼▼
             };

             console.log(`准备保存 Word ID: ${wordId}, 新值: ${newEn}, ${newCn}`);
             listErrorMessageElement.textContent = '\u00A0';
             target.disabled = true;
             target.textContent = '保存中...';
             // 同时禁用取消按钮
             const cancelButton = actionsCell.querySelector('.cancel-button');
             if (cancelButton) cancelButton.disabled = true;


             try {
                 const updatedWord = {
                     english_word: newEn,
                     chinese_definition: newCn
                     // 可以添加例句等
                 };
                 const response = await fetch(`/api/words/${wordId}`, {
                     method: 'PUT',
                     headers: { 'Content-Type': 'application/json' },
                     body: JSON.stringify(updatedWord)
                 });
                 const result = await response.json();

                 if (!response.ok) {
                     throw new Error(result.message || `保存失败: ${response.status}`);
                 }
                 
                 console.log("保存成功:", result);
                 // 保存成功后更新行数据并恢复显示状态
                 wordRow.dataset.en = newEn; // 更新存储在行上的数据
                 wordRow.dataset.cn = newCn;
                 wordRow.dataset.weekTag = newTag;
                 wordRow.querySelector('.word-en').textContent = escapeHTML(newEn);
                 wordRow.querySelector('.word-cn').textContent = escapeHTML(newCn);
                 wordRow.querySelector('.word-week-tag').textContent = escapeHTML(newTag);
                 actionsCell.innerHTML = `
                    <button class="edit-button" data-id="${wordId}">编辑</button>
                    <button class="delete-button" data-id="${wordId}">删除</button>
                 `;

             } catch (error) {
                 console.error('保存单词时出错:', error);
                 listErrorMessageElement.textContent = `保存失败: ${error.message}`;
                 // 出错时恢复按钮状态
                  if(actionsCell) {
                      target.disabled = false; 
                      target.textContent = '保存';
                      if (cancelButton) cancelButton.disabled = false;
                  }
             }
         }

        // --- 处理取消按钮 ---
         if (target.matches('.cancel-button')) {
             if (!wordRow) return;
             const wordId = target.dataset.id;
             const originalEn = wordRow.dataset.en; // 获取之前存的数据
             const originalCn = wordRow.dataset.cn;
             const originalTag = wordRow.dataset.weekTag;
         }
        
        // --- 处理重置进度按钮 ---
        if (target.matches('.reset-progress-button')) {
        const wordId = target.dataset.id;
        const wordRow = target.closest('tr');
        const wordEn = wordRow ? wordRow.dataset.en : '';

        console.log("请求重置进度 Word ID:", wordId);

        if (confirm(`确定要将单词 "${wordEn}" (ID: ${wordId}) 的掌握状态重置为“未掌握”吗？`)) {
            listErrorMessageElement.textContent = '\u00A0'; 
            target.disabled = true;
            target.textContent = '重置中...';

            try {
                const response = await fetch(`/api/progress/reset/${wordId}`, { method: 'PUT' });
                const result = await response.json();

                if (!response.ok) {
                    throw new Error(result.message || `重置失败: ${response.status}`);
                }
                console.log("重置进度成功:", result);
                // 重置成功后，理想情况下只更新该行的状态显示，但简单起见先刷新整个列表
                loadWords(filterWeekTagInput.value.trim() || null); // 刷新列表 (如果当前有筛选，则带上筛选条件)

            } catch (error) {
                console.error('重置进度时出错:', error);
                listErrorMessageElement.textContent = `重置失败: ${error.message}`;
                target.disabled = false; // 恢复按钮
                target.textContent = '重置进度';
                }
        }
        }
        
    }); // --- wordListBody 的 'click' 事件监听函数结束 ---

    loadWords();

});
