function escapeHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function inline(text) {
  let value = escapeHtml(text);
  value = value.replace(/`([^`\n]{1,200})`/g, '<code>$1</code>');
  value = value.replace(/!\[([^\]\n]{1,160})\]\((\/(?:logo\.png|qr\.svg|release-media\/[a-z0-9][a-z0-9._-]*\.(?:png|jpe?g|webp|svg)))\)/gi, (_match, alt, url) =>
    `<img src="${url}" alt="${alt}" loading="lazy" decoding="async">`);
  value = value.replace(/\[([^\]\n]{1,120})\]\((https?:\/\/[^\s)<>]{1,500}|\/[a-z0-9._/?=&%-]{1,500})\)/gi, (_match, label, url) =>
    `<a href="${url}" rel="nofollow noreferrer noopener" target="_blank">${label}</a>`);
  value = value.replace(/\*\*([^*\n]{1,300})\*\*/g, '<strong>$1</strong>');
  value = value.replace(/(?<!\*)\*([^*\n]{1,300})\*(?!\*)/g, '<em>$1</em>');
  return value;
}

export function renderMarkdown(markdown) {
  if (typeof markdown !== 'string') return '';
  const lines = markdown.replaceAll('\r\n', '\n').split('\n');
  const output = [];
  let paragraph = [], code = [], list = [], inCode = false, language = '';
  const flushParagraph = () => {
    if (!paragraph.length) return;
    output.push(`<p>${paragraph.map(inline).join('<br>')}</p>`);
    paragraph = [];
  };
  const flushCode = () => {
    output.push(`<pre><code${language ? ` class="language-${language}"` : ''}>${escapeHtml(code.join('\n'))}</code></pre>`);
    code = []; language = '';
  };
  const flushList = () => {
    if (!list.length) return;
    output.push(`<ul>${list.map(item => `<li>${inline(item)}</li>`).join('')}</ul>`);
    list = [];
  };
  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inCode) { flushCode(); inCode = false; }
      else { flushParagraph(); flushList(); language = /^[a-z0-9_+-]{1,24}$/i.test(line.slice(3).trim()) ? line.slice(3).trim().toLowerCase() : ''; inCode = true; }
      continue;
    }
    if (inCode) { code.push(line); continue; }
    const heading = line.match(/^(#{2,4})\s+(.+)$/);
    if (heading) { flushParagraph(); flushList(); const level = heading[1].length; output.push(`<h${level}>${inline(heading[2])}</h${level}>`); continue; }
    if (/^---+$/.test(line.trim())) { flushParagraph(); flushList(); output.push('<hr>'); continue; }
    const item = line.match(/^[-*]\s+(.+)$/);
    if (item) { flushParagraph(); list.push(item[1]); continue; }
    if (!line.trim()) { flushParagraph(); flushList(); } else { flushList(); paragraph.push(line); }
  }
  if (inCode) flushCode(); else { flushParagraph(); flushList(); }
  return output.join('\n');
}
