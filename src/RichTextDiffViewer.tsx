// RichTextDiffViewer.tsx

import React, { useEffect, useState, useRef } from "react";
import DiffMatchPatch from "diff-match-patch";
import * as htmldiff from "htmldiff-js";

interface Props {
  oldHtml: string;
  newHtml: string;
}

// Map các node sang cấu trúc DOM với đường dẫn và nội dung text
interface TextNodeMap {
  path: number[];
  text: string;
  node: Node;
  startPos: number; // Vị trí bắt đầu trong tổng text
  endPos: number; // Vị trí kết thúc trong tổng text
}

// Hàm trích xuất tất cả các text node từ một DOM element
const extractTextNodes = (
  root: Node,
  path: number[] = [],
  textPositions: { pos: number } = { pos: 0 }
): TextNodeMap[] => {
  const textNodes: TextNodeMap[] = [];

  // Duyệt qua tất cả các node con
  for (let i = 0; i < root.childNodes.length; i++) {
    const node = root.childNodes[i];
    const currentPath = [...path, i];

    // Nếu là text node, thêm vào danh sách
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || "";
      const startPos = textPositions.pos;
      textPositions.pos += text.length;

      textNodes.push({
        path: currentPath,
        text,
        node,
        startPos,
        endPos: textPositions.pos,
      });
    }
    // Nếu là element node, đệ quy tìm các text node bên trong
    else if (node.nodeType === Node.ELEMENT_NODE) {
      textNodes.push(...extractTextNodes(node, currentPath, textPositions));
    }
  }

  return textNodes;
};

// Hàm tìm node theo đường dẫn
const findNodeByPath = (root: Node, path: number[]): Node | null => {
  let current = root;

  for (const index of path) {
    if (!current.childNodes[index]) return null;
    current = current.childNodes[index];
  }

  return current;
};

// Hàm so sánh sâu giữa hai cây DOM
const deepCompareAndMarkChanges = (
  oldContainer: HTMLElement,
  newContainer: HTMLElement
): void => {
  // Bước 1: Phân tích cấu trúc và tạo bản đồ node
  const createNodeMap = (container: HTMLElement, prefix: string = "") => {
    const nodeMap = new Map<
      string,
      {
        element: Element;
        signature: string;
        textContent: string;
        path: string;
        depth: number;
        highlighted: boolean; // Trạng thái đã highlight hay chưa
        parent: string; // Thêm tham chiếu đến node cha
      }
    >();

    const processNode = (
      node: Element,
      path: string,
      depth: number = 0,
      parentPath: string = ""
    ) => {
      // Tạo chữ ký cho node dựa trên tag, attributes và cấu trúc con
      let signature = node.tagName.toLowerCase();

      // Thêm các attribute vào chữ ký (trừ các data-lexical)
      const attributes = Array.from(node.attributes)
        .filter((attr) => !attr.name.startsWith("data-lexical"))
        .map((attr) => `${attr.name}="${attr.value}"`)
        .join(" ");

      if (attributes) {
        signature += ` ${attributes}`;
      }

      // Thêm childNode count vào chữ ký để phát hiện thay đổi cấu trúc
      signature += `:${node.childNodes.length}`;

      nodeMap.set(path, {
        element: node,
        signature,
        textContent: node.textContent || "",
        path,
        depth,
        highlighted: false,
        parent: parentPath,
      });

      // Xử lý đệ quy cho các node con
      Array.from(node.children).forEach((child, index) => {
        processNode(child as Element, `${path}/${index}`, depth + 1, path);
      });
    };

    // Xử lý tất cả các element con trực tiếp
    Array.from(container.children).forEach((child, index) => {
      processNode(child as Element, `${prefix}/${index}`, 0, prefix);
    });

    return nodeMap;
  };

  const oldNodeMap = createNodeMap(oldContainer, "old");
  const newNodeMap = createNodeMap(newContainer, "new");

  // Bước 2: So sánh các node để tìm node giống nhau, giống một phần, hoặc khác hoàn toàn

  // Tạo ánh xạ từ node cũ sang node mới dựa trên chữ ký và nội dung
  const nodeMapping = new Map<string, string>(); // oldPath -> newPath

  // Danh sách các node đã được so sánh
  const processedOldNodes = new Set<string>();
  const processedNewNodes = new Set<string>();

  // Kiểm tra xem node có cha đã được highlight hay không
  const hasHighlightedAncestor = (
    nodeMap: Map<string, any>,
    path: string
  ): boolean => {
    // Lấy node hiện tại
    const node = nodeMap.get(path);
    if (!node) return false;

    // Kiểm tra các node cha
    let currentParent = node.parent;
    while (currentParent && currentParent.length > 1) {
      // Bỏ qua node gốc ("old" hoặc "new")
      const parentNode = nodeMap.get(currentParent);
      if (parentNode && parentNode.highlighted) {
        return true;
      }
      // Di chuyển lên node cha tiếp theo
      currentParent = parentNode ? parentNode.parent : null;
    }

    return false;
  };

  // Đánh dấu node đã được highlight
  const markAsHighlighted = (nodeMap: Map<string, any>, path: string): void => {
    const node = nodeMap.get(path);
    if (node) {
      node.highlighted = true;
    }
  };

  // Sắp xếp node theo độ sâu (depth) để xử lý từ cha đến con
  const sortNodesByDepth = (
    nodeMap: Map<string, any>
  ): Array<[string, any]> => {
    return Array.from(nodeMap.entries()).sort(
      (a, b) => a[1].depth - b[1].depth
    );
  };

  const sortedOldNodes = sortNodesByDepth(oldNodeMap);
  const sortedNewNodes = sortNodesByDepth(newNodeMap);

  // Bước 2.1: Tìm các node hoàn toàn giống nhau (signature và content)
  // Xử lý các node cùng cấp độ, ưu tiên node cha trước
  for (const [oldPath, oldNode] of sortedOldNodes) {
    // Bỏ qua node nếu cha của nó đã được highlight
    if (hasHighlightedAncestor(oldNodeMap, oldPath)) {
      processedOldNodes.add(oldPath); // Đánh dấu node này đã được xử lý
      continue;
    }

    for (const [newPath, newNode] of sortedNewNodes) {
      // Bỏ qua node nếu cha của nó đã được highlight hoặc đã được xử lý
      if (
        hasHighlightedAncestor(newNodeMap, newPath) ||
        processedNewNodes.has(newPath)
      ) {
        continue;
      }

      if (
        oldNode.signature === newNode.signature &&
        oldNode.textContent === newNode.textContent
      ) {
        nodeMapping.set(oldPath, newPath);
        processedOldNodes.add(oldPath);
        processedNewNodes.add(newPath);
        break;
      }
    }
  }

  // Bước 2.2: Tìm các node có cấu trúc giống nhau (signature) nhưng nội dung khác
  for (const [oldPath, oldNode] of sortedOldNodes) {
    // Bỏ qua node đã xử lý hoặc có cha đã highlight
    if (
      processedOldNodes.has(oldPath) ||
      hasHighlightedAncestor(oldNodeMap, oldPath)
    ) {
      continue;
    }

    for (const [newPath, newNode] of sortedNewNodes) {
      // Bỏ qua node đã xử lý hoặc có cha đã highlight
      if (
        processedNewNodes.has(newPath) ||
        hasHighlightedAncestor(newNodeMap, newPath)
      ) {
        continue;
      }

      if (oldNode.signature === newNode.signature) {
        nodeMapping.set(oldPath, newPath);
        processedOldNodes.add(oldPath);
        processedNewNodes.add(newPath);

        // So sánh text để highlight chỉ phần thay đổi
        const diffs = performDiff(oldNode.textContent, newNode.textContent);

        // Kiểm tra xem có thay đổi đáng kể không
        const hasSignificantChanges = diffs.some(
          ([op, text]) => op !== 0 && text.trim().length > 0
        );

        if (hasSignificantChanges) {
          markTextDifferences(oldNode.element, newNode.element, diffs);
          markAsHighlighted(oldNodeMap, oldPath);
          markAsHighlighted(newNodeMap, newPath);
        }
        break;
      }
    }
  }

  // Bước 2.3: Đánh dấu các node không tìm thấy pair
  // Những node chỉ có ở phiên bản cũ - bị xóa
  for (const [oldPath, oldNode] of sortedOldNodes) {
    // Bỏ qua node đã xử lý hoặc có cha đã highlight
    if (
      processedOldNodes.has(oldPath) ||
      hasHighlightedAncestor(oldNodeMap, oldPath)
    ) {
      continue;
    }

    markNodeAsChanged(oldNode.element, "removed");
    markAsHighlighted(oldNodeMap, oldPath);

    // Đánh dấu tất cả con của node này đã được xử lý
    for (const [childPath, childNode] of oldNodeMap) {
      if (childPath.startsWith(`${oldPath}/`)) {
        processedOldNodes.add(childPath);
      }
    }
  }

  // Những node chỉ có ở phiên bản mới - được thêm vào
  for (const [newPath, newNode] of sortedNewNodes) {
    // Bỏ qua node đã xử lý hoặc có cha đã highlight
    if (
      processedNewNodes.has(newPath) ||
      hasHighlightedAncestor(newNodeMap, newPath)
    ) {
      continue;
    }

    markNodeAsChanged(newNode.element, "added");
    markAsHighlighted(newNodeMap, newPath);

    // Đánh dấu tất cả con của node này đã được xử lý
    for (const [childPath, childNode] of newNodeMap) {
      if (childPath.startsWith(`${newPath}/`)) {
        processedNewNodes.add(childPath);
      }
    }
  }
};

// Cải thiện hàm diff để xác định thay đổi tốt hơn
const performDiff = (
  oldText: string,
  newText: string
): Array<[number, string]> => {
  const dmp = new DiffMatchPatch();

  // Chế độ nhạy cảm với dấu cách (space-sensitive mode)
  const spaceSensitiveText = (text: string) => {
    // Thay thế spaces bằng ký tự đặc biệt để diff có thể nhận biết
    return text.replace(/ /g, "\u00A0");
  };

  // Thực hiện diff với chế độ nhạy cảm với dấu cách
  const diffs = dmp.diff_main(
    spaceSensitiveText(oldText),
    spaceSensitiveText(newText)
  );

  // Khôi phục lại spaces từ ký tự đặc biệt
  const normalizedDiffs = diffs.map(([op, text]) => {
    return [op, text.replace(/\u00A0/g, " ")] as [number, string];
  });

  // Làm sạch diff để dễ đọc hơn
  dmp.diff_cleanupSemantic(normalizedDiffs);

  // Thêm bước làm sạch "word mode" để phát hiện các thay đổi ở mức từ
  dmp.diff_cleanupEfficiency(normalizedDiffs);

  // Xử lý theo từng đơn vị từ
  return forceDiffByWords(normalizedDiffs);
};

// Hàm mới tách và gộp các diff theo từ
const forceDiffByWords = (
  diffs: Array<[number, string]>
): Array<[number, string]> => {
  // Tách văn bản thành các từ
  const wordPattern = /([^\s.,;:!?()]+)|([.,;:!?()])/g;

  const result: Array<[number, string]> = [];

  // Xử lý từng phần diff
  for (let [op, text] of diffs) {
    if (op === 0) {
      // Không thay đổi, giữ nguyên
      result.push([op, text]);
      continue;
    }

    // Nếu text chỉ chứa khoảng trắng, giữ nguyên
    if (/^\s+$/.test(text)) {
      result.push([op, text]);
      continue;
    }

    // Tách text thành các từ và khoảng trắng
    let lastIndex = 0;
    let match;
    let inWordBoundary = false;

    const regex = new RegExp(wordPattern);
    while ((match = regex.exec(text)) !== null) {
      const word = match[0];
      const startPos = match.index;

      // Xử lý khoảng trắng trước từ nếu có
      if (startPos > lastIndex) {
        const spaces = text.substring(lastIndex, startPos);
        result.push([op, spaces]);
      }

      // Thêm từ vào kết quả
      result.push([op, word]);

      lastIndex = startPos + word.length;
    }

    // Xử lý phần còn lại nếu có
    if (lastIndex < text.length) {
      result.push([op, text.substring(lastIndex)]);
    }
  }

  return result;
};

// Hàm đánh dấu những thay đổi văn bản trong các node có cấu trúc giống nhau
const markTextDifferences = (
  oldElement: Element,
  newElement: Element,
  diffs: Array<[number, string]>
): void => {
  // Trích xuất tất cả các text node từ cả hai element
  const extractTextNodesWithPositions = (element: Element) => {
    const result: { node: Text; start: number; end: number }[] = [];
    let position = 0;

    const processNode = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent || "";
        result.push({
          node: node as Text,
          start: position,
          end: position + text.length,
        });
        position += text.length;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        Array.from(node.childNodes).forEach(processNode);
      }
    };

    processNode(element);
    return result;
  };

  const oldTextNodes = extractTextNodesWithPositions(oldElement);
  const newTextNodes = extractTextNodesWithPositions(newElement);

  // Chuyển diffs sang danh sách các từ có vị trí
  const processedOldContent = processContentWithWords(
    oldElement.textContent || "",
    diffs.filter(([op]) => op !== 1) // Chỉ lấy không đổi (0) và xóa (-1)
  );

  const processedNewContent = processContentWithWords(
    newElement.textContent || "",
    diffs.filter(([op]) => op !== -1) // Chỉ lấy không đổi (0) và thêm (1)
  );

  // Áp dụng highlight cho các từ được xác định
  applyWordHighlighting(oldTextNodes, processedOldContent, "removed");
  applyWordHighlighting(newTextNodes, processedNewContent, "added");
};

// Xử lý nội dung để xác định vị trí chính xác của từng từ
const processContentWithWords = (
  content: string,
  diffs: Array<[number, string]>
): Array<{ start: number; end: number; text: string; isChanged: boolean }> => {
  const result: Array<{
    start: number;
    end: number;
    text: string;
    isChanged: boolean;
  }> = [];
  let position = 0;

  for (const [op, text] of diffs) {
    // Tách text thành các từ
    const words = splitIntoWords(text);

    for (const word of words) {
      result.push({
        start: position,
        end: position + word.length,
        text: word,
        isChanged: op !== 0, // true nếu là thay đổi
      });

      position += word.length;
    }
  }

  return result;
};

// Tách văn bản thành các từ, giữ nguyên khoảng trắng
const splitIntoWords = (text: string): string[] => {
  // Chuỗi không có gì
  if (!text) return [];

  // Nếu chỉ có khoảng trắng
  if (/^\s+$/.test(text)) return [text];

  const pattern = /([^\s.,;:!?()]+)|([.,;:!?()])|(\s+)/g;
  const result: string[] = [];

  let match;
  let lastIndex = 0;

  while ((match = pattern.exec(text)) !== null) {
    const word = match[0];
    result.push(word);
    lastIndex = match.index + word.length;
  }

  // Kiểm tra nếu còn sót
  if (lastIndex < text.length) {
    result.push(text.substring(lastIndex));
  }

  return result;
};

// Áp dụng highlight cho các từ đã được xác định
const applyWordHighlighting = (
  textNodes: Array<{ node: Text; start: number; end: number }>,
  words: Array<{
    start: number;
    end: number;
    text: string;
    isChanged: boolean;
  }>,
  changeType: string
) => {
  // Danh sách node đã xử lý
  const processedNodes = new Set<Text>();

  // Nhóm các từ liền kề cùng loại thay đổi
  const groupedWords: Array<{
    start: number;
    end: number;
    isChanged: boolean;
  }> = [];
  let currentGroup: { start: number; end: number; isChanged: boolean } | null =
    null;

  for (const word of words) {
    if (!currentGroup) {
      currentGroup = {
        start: word.start,
        end: word.end,
        isChanged: word.isChanged,
      };
    } else if (currentGroup.isChanged === word.isChanged) {
      // Mở rộng nhóm hiện tại
      currentGroup.end = word.end;
    } else {
      // Kết thúc nhóm hiện tại và bắt đầu nhóm mới
      groupedWords.push(currentGroup);
      currentGroup = {
        start: word.start,
        end: word.end,
        isChanged: word.isChanged,
      };
    }
  }

  // Thêm nhóm cuối cùng
  if (currentGroup) {
    groupedWords.push(currentGroup);
  }

  // Áp dụng highlight cho các nhóm từ
  for (const group of groupedWords) {
    if (!group.isChanged) continue; // Bỏ qua các nhóm không thay đổi

    // Tìm các text node chứa nhóm này
    const affectedNodes: Array<{
      node: Text;
      localStart: number;
      localEnd: number;
    }> = [];

    for (const { node, start, end } of textNodes) {
      if (processedNodes.has(node)) continue;

      // Kiểm tra xem node có chứa nhóm từ không
      if (end <= group.start || start >= group.end) continue;

      // Tính vị trí thay đổi trong node hiện tại
      const localStart = Math.max(0, group.start - start);
      const localEnd = Math.min(
        node.textContent?.length || 0,
        group.end - start
      );

      if (localStart < localEnd) {
        affectedNodes.push({ node, localStart, localEnd });
      }
    }

    // Áp dụng highlight cho các node bị ảnh hưởng
    for (const { node, localStart, localEnd } of affectedNodes) {
      const content = node.textContent || "";

      // Bỏ qua nếu nội dung chỉ là khoảng trắng
      if (content.substring(localStart, localEnd).trim() === "") continue;

      const before = content.substring(0, localStart);
      const highlighted = content.substring(localStart, localEnd);
      const after = content.substring(localEnd);

      // Lấy thông tin về node cha để bảo toàn style
      const parentNode = node.parentNode;
      if (!parentNode) continue;

      // Bảo toàn các style và thuộc tính của parent node
      const preserveParentAttributes = () => {
        if (!(parentNode instanceof HTMLElement)) return {};

        // Lấy các style inline (nếu có)
        const inlineStyle = parentNode.getAttribute("style") || "";

        // Lấy các class CSS
        const classNames = Array.from(parentNode.classList).join(" ");

        return {
          style: inlineStyle,
          class: classNames,
        };
      };

      const parentAttributes = preserveParentAttributes();

      // Tạo các node mới
      const fragment = document.createDocumentFragment();

      if (before) {
        fragment.appendChild(document.createTextNode(before));
      }

      // Tạo span giữ nguyên style của parent nhưng thêm class highlight
      const span = document.createElement("span");
      span.className = `diff-${changeType}`;

      // Áp dụng các style/class gốc của parent nếu có
      if (parentAttributes.style) {
        span.setAttribute("style", parentAttributes.style);
      }

      if (parentAttributes.class) {
        // Thêm các class gốc nhưng vẫn giữ class highlight
        span.classList.add(...parentAttributes.class.split(" "));
      }

      span.textContent = highlighted;
      fragment.appendChild(span);

      if (after) {
        fragment.appendChild(document.createTextNode(after));
      }

      // Thay thế node cũ với nội dung mới đã highlight
      node.parentNode.replaceChild(fragment, node);
      processedNodes.add(node);
    }
  }
};

// Hàm để áp dụng highlight cho node đã thay đổi cấu trúc
const markNodeAsChanged = (node: Element, changeType: string): void => {
  // Nếu node không phải là element thì bỏ qua
  if (!(node instanceof HTMLElement)) return;

  // Lưu trữ các style và class gốc
  const originalStyle = node.getAttribute("style") || "";
  const originalClasses = Array.from(node.classList);

  // Thêm class cho việc highlight nhưng giữ nguyên các style gốc
  node.classList.add(`diff-node-${changeType}`);

  // Nếu style bị ghi đè bởi CSS của diff, khôi phục lại
  const computedStyle = window.getComputedStyle(node);
  const backgroundWasChanged = computedStyle.backgroundColor !== "transparent";

  if (backgroundWasChanged && originalStyle) {
    // Thêm attribute data để lưu style gốc
    node.setAttribute("data-original-style", originalStyle);
  }
};

// Cập nhật hàm markStructuralChanges để sử dụng hàm mới
const markStructuralChanges = (
  oldContainer: HTMLElement,
  newContainer: HTMLElement
): void => {
  // Thực hiện so sánh sâu giữa DOM trees
  deepCompareAndMarkChanges(oldContainer, newContainer);

  // Bỏ qua việc đánh dấu thay đổi trong danh sách
  // markListChanges(oldContainer, newContainer);

  // Đánh dấu thay đổi khoảng trắng
  markWhitespaceChanges(oldContainer);
  markWhitespaceChanges(newContainer);
};

// Đánh dấu thay đổi kiểu danh sách (bullet vs ordered)
const markListChanges = (
  oldContainer: HTMLElement,
  newContainer: HTMLElement
): void => {
  // Tìm tất cả các phần tử ul và ol trong cả hai container
  const oldLists = {
    ul: Array.from(oldContainer.querySelectorAll("ul")),
    ol: Array.from(oldContainer.querySelectorAll("ol")),
  };

  const newLists = {
    ul: Array.from(newContainer.querySelectorAll("ul")),
    ol: Array.from(newContainer.querySelectorAll("ol")),
  };

  // So sánh cấu trúc danh sách theo thứ tự xuất hiện
  const oldListItems = [...oldLists.ul, ...oldLists.ol].flatMap((list) =>
    Array.from(list.querySelectorAll("li")).map((li) => ({
      element: li,
      text: li.textContent || "",
      type: list.tagName.toLowerCase(),
      parent: list,
    }))
  );

  const newListItems = [...newLists.ul, ...newLists.ol].flatMap((list) =>
    Array.from(list.querySelectorAll("li")).map((li) => ({
      element: li,
      text: li.textContent || "",
      type: list.tagName.toLowerCase(),
      parent: list,
    }))
  );

  // 1. Đánh dấu các mục danh sách có nội dung giống nhau nhưng loại danh sách khác nhau
  for (const oldItem of oldListItems) {
    const matchingNewItem = newListItems.find(
      (newItem) =>
        newItem.text === oldItem.text && newItem.type !== oldItem.type
    );

    if (matchingNewItem) {
      // Highlight cả list, không thêm ký tự
      if (oldItem.parent) {
        oldItem.parent.classList.add("diff-list-type-changed");
      }
      if (matchingNewItem.parent) {
        matchingNewItem.parent.classList.add("diff-list-type-changed");
      }

      // Highlight mục thay đổi kiểu
      oldItem.element.classList.add("diff-list-item-type-changed");
      matchingNewItem.element.classList.add("diff-list-item-type-changed");
    }
  }

  // 2. Phát hiện mục danh sách bị xóa (chỉ có trong danh sách cũ)
  for (const oldItem of oldListItems) {
    const existsInNew = newListItems.some(
      (newItem) => newItem.text === oldItem.text
    );

    if (!existsInNew) {
      oldItem.element.classList.add("diff-list-item-removed");
    }
  }

  // 3. Phát hiện mục danh sách được thêm mới (chỉ có trong danh sách mới)
  for (const newItem of newListItems) {
    const existsInOld = oldListItems.some(
      (oldItem) => oldItem.text === newItem.text
    );

    if (!existsInOld) {
      newItem.element.classList.add("diff-list-item-added");
    }
  }

  // 4. Phát hiện thay đổi thứ tự mục danh sách
  // Tìm các mục có cùng nội dung nhưng khác vị trí
  const oldTexts = oldListItems.map((item) => item.text);
  const newTexts = newListItems.map((item) => item.text);

  // Chỉ xử lý các mục tồn tại ở cả hai danh sách
  const commonItems = oldTexts.filter((text) => newTexts.includes(text));

  for (const text of commonItems) {
    const oldIndex = oldTexts.indexOf(text);
    const newIndex = newTexts.indexOf(text);

    // Nếu mục xuất hiện ở vị trí khác nhau trong hai danh sách
    if (oldIndex !== newIndex) {
      // Lấy vị trí tương đối của mục so với các mục khác
      const oldRelativePosition = commonItems
        .filter((t) => t !== text)
        .map((t) => oldTexts.indexOf(t) < oldIndex);

      const newRelativePosition = commonItems
        .filter((t) => t !== text)
        .map((t) => newTexts.indexOf(t) < newIndex);

      // Kiểm tra xem thứ tự tương đối có thay đổi không
      const hasOrderChanged = oldRelativePosition.some(
        (pos, idx) => pos !== newRelativePosition[idx]
      );

      if (hasOrderChanged) {
        const oldItem = oldListItems[oldIndex];
        const newItem = newListItems[newIndex];

        oldItem.element.classList.add("diff-list-item-reordered");
        newItem.element.classList.add("diff-list-item-reordered");
      }
    }
  }
};

// Đánh dấu thay đổi khoảng trắng
const markWhitespaceChanges = (container: HTMLElement): void => {
  // Tìm tất cả text node
  const textWalker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    null
  );

  const textNodes: Text[] = [];
  let currentNode: Node | null;

  while ((currentNode = textWalker.nextNode())) {
    textNodes.push(currentNode as Text);
  }

  // Highlight khoảng trắng đặc biệt
  for (const node of textNodes) {
    const content = node.textContent || "";

    // Phát hiện spaces liên tiếp (>1)
    const multipleSpacesRegex = /( {2,})/g;
    let match;
    let lastIndex = 0;
    let newContent = "";

    while ((match = multipleSpacesRegex.exec(content)) !== null) {
      // Thêm phần trước match
      newContent += content.substring(lastIndex, match.index);

      // Chỉ highlight không thêm ký tự
      const spaces = match[0];
      const spacesSpan = `<span class="diff-whitespace" style="white-space: pre-wrap;">${spaces}</span>`;
      newContent += spacesSpan;

      lastIndex = match.index + spaces.length;
    }

    // Thêm phần còn lại
    if (lastIndex < content.length) {
      newContent += content.substring(lastIndex);
    }

    // Chỉ thay thế nếu có thay đổi
    if (newContent && newContent !== content) {
      // Tạo span bọc nội dung mới
      const tempSpan = document.createElement("span");
      tempSpan.innerHTML = newContent;

      // Thay thế node cũ
      const parent = node.parentNode;
      if (parent) {
        parent.replaceChild(tempSpan, node);
      }
    }
  }
};

// Hàm áp dụng thay đổi vào text node
const applyTextNodeChanges = (
  container: HTMLElement,
  textNodes: TextNodeMap[],
  changes: Array<{
    start: number;
    end: number;
    text: string;
    type: "removed" | "added";
  }>
): string => {
  if (changes.length === 0) return container.innerHTML;

  // Sắp xếp thay đổi theo vị trí (từ cuối lên đầu để tránh ảnh hưởng khi thay thế)
  const sortedChanges = [...changes].sort((a, b) => b.start - a.start);

  // Tạo bản sao container để thao tác
  const containerClone = container.cloneNode(true) as HTMLElement;

  // Hàm tạo span highlight
  const createSpan = (
    text: string,
    type: "removed" | "added"
  ): HTMLSpanElement => {
    const span = document.createElement("span");
    span.className = `diff-${type}`;
    span.textContent = text;
    return span;
  };

  // Xử lý từng thay đổi
  for (const change of sortedChanges) {
    // Tìm các text node bị ảnh hưởng bởi thay đổi này
    const affectedNodes: {
      node: TextNodeMap;
      localStart: number;
      localEnd: number;
    }[] = [];

    for (const node of textNodes) {
      // Kiểm tra nếu thay đổi này ảnh hưởng đến node hiện tại
      if (node.endPos <= change.start || node.startPos >= change.end) continue;

      // Tính vị trí thay đổi trong node hiện tại
      const localStart = Math.max(0, change.start - node.startPos);
      const localEnd = Math.min(node.text.length, change.end - node.startPos);

      if (localStart < localEnd) {
        affectedNodes.push({
          node,
          localStart,
          localEnd,
        });
      }
    }

    // Áp dụng thay đổi vào các node bị ảnh hưởng
    for (const { node, localStart, localEnd } of affectedNodes) {
      const targetNode = findNodeByPath(containerClone, node.path);
      if (!targetNode || targetNode.nodeType !== Node.TEXT_NODE) continue;

      const originalText = targetNode.textContent || "";
      const before = originalText.substring(0, localStart);
      const middle = originalText.substring(localStart, localEnd);
      const after = originalText.substring(localEnd);

      const span = createSpan(middle, change.type);

      const parent = targetNode.parentNode;
      if (!parent) continue;

      // Thay thế node cũ bằng 3 phần: trước, thay đổi (highlight), sau
      if (before) {
        const beforeNode = document.createTextNode(before);
        parent.insertBefore(beforeNode, targetNode);
      }

      parent.insertBefore(span, targetNode);

      if (after) {
        const afterNode = document.createTextNode(after);
        parent.insertBefore(afterNode, targetNode);
      }

      parent.removeChild(targetNode);
    }
  }

  return containerClone.innerHTML;
};

// Hàm highlight các thay đổi
const highlightChanges = (
  oldHtmlContainer: HTMLElement,
  newHtmlContainer: HTMLElement,
  diffs: Array<[number, string]>
): [string, string] => {
  // Đánh dấu thay đổi cấu trúc trước
  markStructuralChanges(oldHtmlContainer, newHtmlContainer);

  // Trích xuất tất cả text node
  const oldTextNodes = extractTextNodes(oldHtmlContainer);
  const newTextNodes = extractTextNodes(newHtmlContainer);

  // Lấy text hoàn chỉnh
  const oldFullText = oldHtmlContainer.textContent || "";
  const newFullText = newHtmlContainer.textContent || "";

  // Chuyển đổi diffs sang mảng thay đổi với vị trí chính xác
  const oldChanges: Array<{
    start: number;
    end: number;
    text: string;
    type: "removed" | "added";
  }> = [];
  const newChanges: Array<{
    start: number;
    end: number;
    text: string;
    type: "removed" | "added";
  }> = [];

  let oldPos = 0;
  let newPos = 0;

  for (const [operation, text] of diffs) {
    switch (operation) {
      case 0: // Không thay đổi
        oldPos += text.length;
        newPos += text.length;
        break;
      case -1: // Xóa từ văn bản cũ
        oldChanges.push({
          start: oldPos,
          end: oldPos + text.length,
          text,
          type: "removed",
        });
        oldPos += text.length;
        break;
      case 1: // Thêm vào văn bản mới
        newChanges.push({
          start: newPos,
          end: newPos + text.length,
          text,
          type: "added",
        });
        newPos += text.length;
        break;
    }
  }

  // Áp dụng thay đổi vào cả hai container
  const highlightedOldHtml = applyTextNodeChanges(
    oldHtmlContainer,
    oldTextNodes,
    oldChanges
  );
  const highlightedNewHtml = applyTextNodeChanges(
    newHtmlContainer,
    newTextNodes,
    newChanges
  );

  return [highlightedOldHtml, highlightedNewHtml];
};

// Hàm thực hiện HTML diff trực tiếp sử dụng htmldiff-js
const performHtmlDiff = (oldHtml: string, newHtml: string): string => {
  // Perform the HTML diff without config (htmldiff.default only accepts 2 arguments)
  return htmldiff.default(oldHtml, newHtml);
};

const RichTextDiffViewer: React.FC<Props> = ({ oldHtml, newHtml }) => {
  const [diffHtml, setDiffHtml] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState<boolean>(true);
  const [diffMode, setDiffMode] = useState<"side-by-side" | "inline">(
    "side-by-side"
  );

  const oldContainerRef = useRef<HTMLDivElement>(null);
  const newContainerRef = useRef<HTMLDivElement>(null);
  const diffContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setIsProcessing(true);

    // Traditional side-by-side diff approach
    const processSideBySideDiff = () => {
      if (!oldContainerRef.current || !newContainerRef.current) return;

      // Render HTML vào containers
      oldContainerRef.current.innerHTML = oldHtml;
      newContainerRef.current.innerHTML = newHtml;

      // Lấy text để so sánh
      const oldText = oldContainerRef.current.textContent || "";
      const newText = newContainerRef.current.textContent || "";

      // Nếu text hoàn toàn giống nhau, kiểm tra cấu trúc DOM
      if (oldText === newText && oldHtml !== newHtml) {
        // Đánh dấu thay đổi cấu trúc DOM
        markStructuralChanges(oldContainerRef.current, newContainerRef.current);
        return;
      }

      // Thực hiện diff với cải tiến
      const diffs = performDiff(oldText, newText);

      // Highlight các thay đổi trong HTML gốc
      try {
        const [highlightedOldHtml, highlightedNewHtml] = highlightChanges(
          oldContainerRef.current,
          newContainerRef.current,
          diffs
        );

        // Áp dụng HTML đã highlight vào container
        oldContainerRef.current.innerHTML = highlightedOldHtml;
        newContainerRef.current.innerHTML = highlightedNewHtml;
      } catch (error) {
        console.error("Lỗi khi highlight thay đổi:", error);
        // Reset to original HTML if highlighting fails
        oldContainerRef.current.innerHTML = oldHtml;
        newContainerRef.current.innerHTML = newHtml;
      }
    };

    // Inline diff approach with htmldiff-js
    const processInlineDiff = () => {
      if (!diffContainerRef.current) return;

      try {
        // Sanitize HTML to prevent issues with htmldiff-js
        const sanitizedOldHtml = oldHtml.replace(
          /data-lexical-[^=]+=["'][^"']*["']/g,
          ""
        );
        const sanitizedNewHtml = newHtml.replace(
          /data-lexical-[^=]+=["'][^"']*["']/g,
          ""
        );

        // Perform the HTML diff
        const diffResult = performHtmlDiff(sanitizedOldHtml, sanitizedNewHtml);

        // Set the result to the diff container
        setDiffHtml(diffResult);
      } catch (error) {
        console.error("Error in HTML diff:", error);
        // Fallback to showing both versions
        setDiffHtml(`
          <div style="border-bottom: 1px solid #ccc; margin-bottom: 16px; padding-bottom: 16px;">
            <h3>Trước khi thay đổi</h3>
            ${oldHtml}
          </div>
          <div>
            <h3>Sau khi thay đổi</h3>
            ${newHtml}
          </div>
        `);
      }
    };

    // Process based on the selected diff mode
    if (diffMode === "side-by-side") {
      processSideBySideDiff();
    } else {
      processInlineDiff();
    }

    setIsProcessing(false);
  }, [oldHtml, newHtml, diffMode]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {isProcessing && <div style={{ textAlign: "center" }}>Đang xử lý...</div>}

      <div style={{ marginBottom: 16 }}>
        <label style={{ marginRight: 16 }}>
          <input
            type="radio"
            name="diffMode"
            value="side-by-side"
            checked={diffMode === "side-by-side"}
            onChange={() => setDiffMode("side-by-side")}
          />
          Xem song song
        </label>
        <label>
          <input
            type="radio"
            name="diffMode"
            value="inline"
            checked={diffMode === "inline"}
            onChange={() => setDiffMode("inline")}
          />
          Xem tích hợp
        </label>
      </div>

      {diffMode === "side-by-side" ? (
        <div style={{ display: "flex", gap: 32 }}>
          {/* Cột trái: Nội dung cũ */}
          <div style={{ flex: 1, border: "1px solid #eee", padding: 16 }}>
            <div style={{ marginBottom: 8 }}>
              <strong>Trước khi thay đổi</strong>
            </div>
            <div className="lexical-content" ref={oldContainerRef} />
          </div>

          {/* Cột phải: Nội dung mới */}
          <div style={{ flex: 1, border: "1px solid #eee", padding: 16 }}>
            <div style={{ marginBottom: 8 }}>
              <strong>Sau khi thay đổi</strong>
            </div>
            <div className="lexical-content" ref={newContainerRef} />
          </div>
        </div>
      ) : (
        <div style={{ border: "1px solid #eee", padding: 16 }}>
          <div style={{ marginBottom: 8 }}>
            <strong>Thay đổi được đánh dấu</strong>
          </div>
          <div
            className="lexical-content"
            ref={diffContainerRef}
            dangerouslySetInnerHTML={{ __html: diffHtml }}
          />
        </div>
      )}

      {/* Styles cho diff - CHỈ áp dụng cho highlight, không ảnh hưởng đến định dạng khác */}
      <style>{`
        .diff-removed {
          background: #ffeeee;
          color: #cc0000;
          text-decoration: line-through;
          border-radius: 2px;
          padding: 0 2px;
          display: inline-block;
        }
        .diff-added {
          background: #eeffee;
          color: #008800;
          border-radius: 2px;
          padding: 0 2px;
          display: inline-block;
        }
        /* Styles cho thay đổi node - chỉ áp dụng viền, giữ nguyên background */
        .diff-node-removed {
          border: 1px solid #ffcccc;
          border-left: 3px solid #ff0000;
          padding: 2px;
          border-radius: 2px;
          position: relative;
        }
        .diff-node-removed::after {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: rgba(255, 238, 238, 0.4);
          pointer-events: none;
          z-index: 1;
        }
        .diff-node-added {
          border: 1px solid #ccffcc;
          border-left: 3px solid #008800;
          padding: 2px;
          border-radius: 2px;
          position: relative;
        }
        .diff-node-added::after {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: rgba(238, 255, 238, 0.4);
          pointer-events: none;
          z-index: 1;
        }
        /* Styles cho thay đổi khoảng trắng - chỉ highlight không thêm ký tự */
        .diff-whitespace {
          background: #f0f8ff;
          white-space: pre-wrap;
          border-radius: 2px;
        }
        /* Đảm bảo Lexical content được hiển thị đúng */
        .lexical-content {
          text-align: initial;
          font-family: inherit;
          line-height: inherit;
          white-space: pre-wrap;
        }
        /* Đảm bảo headings, paragraphs và các elements khác giữ nguyên định dạng */
        .lexical-content h1, .lexical-content h2, .lexical-content h3, 
        .lexical-content p, .lexical-content ul, .lexical-content ol {
          text-align: inherit;
          margin: inherit;
        }
        /* Đã bỏ qua các style liên quan đến list */
      `}</style>
    </div>
  );
};

export default RichTextDiffViewer;
