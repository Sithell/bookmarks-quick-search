// Copyright 2018 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

'use strict';

const MAX_BOOKMARKS = 10;
let search = document.getElementById('search');
const root = document.getElementById('root');

// chrome.storage.sync.get('color', function (data) {
//   changeColor.style.backgroundColor = data.color;
//   changeColor.setAttribute('value', data.color);
// });

/** @type {() => Promise<chrome.bookmarks.BookmarkTreeNode[]>} */
const getTree = () => new Promise((r) => chrome.bookmarks.getTree(r));

setTimeout(loadResults, 1);
search.focus();

/**
 * @param {string[]} chars
 * @param {number} length
 */
function allCombinations(chars, length) {
  let ret = [...chars];
  for (let i = 0; i < length - 1; i++) {
    ret = [...new Set(ret)]
      .map((s) => {
        return [...chars].map((ch) => s + ch);
      })
      .flat()
      .sort(
        (s1, s2) =>
          util.keyboardDistance(...s1.slice(-2)) -
          util.keyboardDistance(...s2.slice(-2))
      );
  }
  return ret;
}

let timeoutHandlerOfLoadShortcuts;
let iteration = 1;

/** @param {string} q */
async function loadResults(q, loadShortcuts = false) {
  clearTimeout(timeoutHandlerOfLoadShortcuts);
  const currIteration = ++iteration;

  let all = await getBookmarks();
  let bookmarks = filterBookmarks(all, q);

  if (iteration !== currIteration) {
    return;
  }

  const hasMore = bookmarks.length > MAX_BOOKMARKS;
  bookmarks = bookmarks.slice(0, MAX_BOOKMARKS);

  if (loadShortcuts) {
    bookmarks = await Promise.all(
      bookmarks.map(async (bookmark) => {
        const allChars = (bookmark.title + bookmark.path)
          .toLowerCase()
          .split('');
        let shortcutLength = 0;
        while (++shortcutLength <= 3) {
          const chars = allCombinations(allChars, shortcutLength);
          for (let i = 0; i < chars.length; i++) {
            const ch = chars[i];
            if (iteration !== currIteration) {
              return;
            }
            if (i % 10 === 0) await new Promise((r) => setTimeout(r));
            const matched = filterBookmarks(all, ch)[0].id === bookmark.id;
            if (matched) {
              return { ...bookmark, shortcut: ch };
            }
          }
        }
        return bookmark;
      })
    );
  } else {
    setTimeout(() => {
      loadResults(q, true);
    }, 50);
  }

  if (iteration !== currIteration) {
    return;
  }

  currentNodeOptions = bookmarks;
  currentNodeOptionsIndex = 0;

  root.innerHTML =
    bookmarks
      .map(
        ({ faviconUrl, title, shortcut, path }, i) =>
          `<div id=div_${i}>
            <div>
              <img src="${faviconUrl}" />
              <span style="width: 200px" title="${title}">${title}</span>
              ${
                !shortcut
                  ? ''
                  : `<span style="color: gray" title="Search '${shortcut}' to get this bookmark as the first result">${shortcut}</span>`
              }
            </div>
          ${path ? `<span style="font-size: small">${path}</span>` : ''}
          </div>`
      )
      .join('<hr>') +
    (hasMore
      ? '<hr><div style="cursor: default; color: lightgray">And more...</div>'
      : '');

  boldText(currentNodeOptionsIndex, true);
  bookmarks.forEach((p, i) => {
    const div = document.getElementById('div_' + i);
    div.onclick = () => {
      currentNodeOptionsIndex = i;
      goto();
    };
    div.onmouseenter = () => {
      boldText(currentNodeOptionsIndex, false);
      currentNodeOptionsIndex = i;
      boldText(currentNodeOptionsIndex, true);
    };
  });
}

async function getBookmarks() {
  const tree = await getTree();
  const all = [...tree];
  for (let i = 0; i < all.length; i++) {
    all.push(...(all[i].children || []));
  }
  all.splice(0, 3);

  const bookmarks = all
    .filter((p) => p.url)
    .map((p) => ({
      ...getTitlePath(p, all),
      faviconUrl: `chrome://favicon/${p.url.split('?')[0]}`,
      url: p.url,
      id: p.id
    }));

  return bookmarks;
}

/**
 * @param {string} q 
 * @param {{
    faviconUrl: string;
    url: string;
    id: string;
    title: string;
    path: string;
}[]} bookmarks
*/
function filterBookmarks(bookmarks, q) {
  const words = (q || '')
    .toLowerCase()
    .split(' ')
    .map((q) => q.trim())
    .filter((q) => q);

  let relevantBookmarks = bookmarks
    .filter((p) =>
      words.every((q) =>
        [p.path.toLowerCase(), p.title.toLowerCase()].some((s) => s.includes(q))
      )
    )
    .sort((a, b) =>
      [a, b]
        .map((p) =>
          (p.title.toLowerCase() + p.path.toLowerCase()).indexOf(words[0])
        )
        .reduce((a, b) => a - b)
    );
  if (relevantBookmarks.length === 0) {
    const chars = (q || '').toLowerCase().split('');
    relevantBookmarks = bookmarks.filter((p) => {
      const set = new Set((p.path + p.title).toLowerCase().split(''));
      return chars.every((q) => set.has(q));
    });
  }
  return relevantBookmarks;
}

/**
 * @param {string} q 
 * @param {{
  faviconUrl: string;
  url: string;
  id: string;
  title: string;
  path: string;
}[]} bookmarks
*/
function findFirstMatchingBookmark(bookmarks, q) {
  const words = (q || '')
    .toLowerCase()
    .split(' ')
    .map((q) => q.trim())
    .filter((q) => q);

  let relevantBookmark = bookmarks
    .filter((p) =>
      words.every((q) =>
        [p.path.toLowerCase(), p.title.toLowerCase()].some((s) => s.includes(q))
      )
    )
    .sort((a, b) =>
      [a, b]
        .map((p) =>
          (p.title.toLowerCase() + p.path.toLowerCase()).indexOf(words[0])
        )
        .reduce((a, b) => a - b)
    )[0];
  if (!relevantBookmark) {
    const chars = (q || '').toLowerCase().split('');
    relevantBookmark = bookmarks.find((p) => {
      const set = new Set((p.path + p.title).toLowerCase().split(''));
      return chars.every((q) => set.has(q));
    });
  }
  return relevantBookmark;
}

/** @param {chrome.bookmarks.BookmarkTreeNode} mainNode */
function getTitlePath(mainNode, allNodes) {
  let node = mainNode;
  const title = mainNode.title;

  let path = '';
  node = allNodes.find((p) => p.id === node.parentId);
  while (node) {
    path += `${node.title}/`;
    node = allNodes.find((p) => p.id === node.parentId);
  }

  return { title, path };
}

let currentNodeOptions;
let currentNodeOptionsIndex = 0;
function goto() {
  chrome.tabs.create({
    url: currentNodeOptions[currentNodeOptionsIndex].url
  });
}

search.oninput = () => {
  loadResults(search.value);
};

function boldText(idx, bold) {
  const div = document.getElementById('div_' + idx);
  div.style.fontWeight = bold ? 'bolder' : 'normal';
  div.style.fontSize = bold ? 'large' : 'medium';
}

search.onkeydown = (e) => {
  if (e.key === 'Enter') {
    goto();
  }
  if (e.key === 'ArrowDown') {
    boldText(currentNodeOptionsIndex, false);

    currentNodeOptionsIndex =
      (currentNodeOptionsIndex + 1) % currentNodeOptions.length;

    boldText(currentNodeOptionsIndex, true);
    e.preventDefault();
  }
  if (e.key === 'ArrowUp') {
    boldText(currentNodeOptionsIndex, false);

    currentNodeOptionsIndex =
      (currentNodeOptions.length + currentNodeOptionsIndex - 1) %
      currentNodeOptions.length;

    boldText(currentNodeOptionsIndex, true);
    e.preventDefault();
  }
};