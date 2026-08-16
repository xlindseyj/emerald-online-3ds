function escapeHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function inline(text) {
  let value = escapeHtml(text);
  value = value.replace(/`([^`\n]{1,200})`/g, '<code>$1</code>');
  value = value.replace(/\[([^\]\n]{1,120})\]\((https?:\/\/[^\s)<>]{1,500})\)/g, (_match, label, url) =>
    `<a href="${url}" rel="nofollow noreferrer noopener" target="_blank">${label}</a>`);
  value = value.replace(/\*\*([^*\n]{1,300})\*\*/g, '<strong>$1</strong>');
  value = value.replace(/(?<!\*)\*([^*\n]{1,300})\*(?!\*)/g, '<em>$1</em>');
  return value;
}

export function renderMarkdown(markdown) {
  if (typeof markdown !== 'string') return '';
  const lines = markdown.replaceAll('\r\n', '\n').split('\n');
  const output = [];
  let paragraph = [], code = [], inCode = false, language = '';
  const flushParagraph = () => {
    if (!paragraph.length) return;
    output.push(`<p>${paragraph.map(inline).join('<br>')}</p>`);
    paragraph = [];
  };
  const flushCode = () => {
    output.push(`<pre><code${language ? ` class="language-${language}"` : ''}>${escapeHtml(code.join('\n'))}</code></pre>`);
    code = []; language = '';
  };
  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inCode) { flushCode(); inCode = false; }
      else { flushParagraph(); language = /^[a-z0-9_+-]{1,24}$/i.test(line.slice(3).trim()) ? line.slice(3).trim().toLowerCase() : ''; inCode = true; }
      continue;
    }
    if (inCode) { code.push(line); continue; }
    if (!line.trim()) flushParagraph(); else paragraph.push(line);
  }
  if (inCode) flushCode(); else flushParagraph();
  return output.join('\n');
}
