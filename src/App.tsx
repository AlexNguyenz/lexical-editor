/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import { AutoFocusPlugin } from "@lexical/react/LexicalAutoFocusPlugin";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $isTextNode,
  DOMConversionMap,
  DOMExportOutput,
  DOMExportOutputMap,
  isHTMLElement,
  Klass,
  LexicalEditor,
  LexicalNode,
  ParagraphNode,
  TextNode,
  $getRoot,
  $createTextNode,
  ElementNode,
  RootNode,
  FORMAT_TEXT_COMMAND,
  $getSelection,
  $createRangeSelection,
  $isRangeSelection,
  SELECTION_CHANGE_COMMAND,
  $setSelection,
  $isElementNode,
} from "lexical";
import { HeadingNode } from "@lexical/rich-text";
import { ListNode, ListItemNode } from "@lexical/list";
import { LinkNode } from "@lexical/link";
import { CodeNode } from "@lexical/code";
import { QuoteNode } from "@lexical/rich-text";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  TRANSFORMERS,
} from "@lexical/markdown";
import { $createMarkNode, $isMarkNode, MarkNode } from "@lexical/mark";

import ExampleTheme from "./ExampleTheme";
import ToolbarPlugin from "./plugins/ToolbarPlugin";
import TreeViewPlugin from "./plugins/TreeViewPlugin";
import { parseAllowedColor, parseAllowedFontSize } from "./styleConfig";
import { useState, useEffect } from "react";
import * as React from "react";

const sampleMarkdown = `
# [Your Full Name]
## Contact Information
- **Email:** your.email@example.com
- **Phone:** +1234567890
- **LinkedIn:** linkedin.com/in/yourprofile
- **GitHub:** github.com/yourusername
- **Portfolio:** yourportfolio.com
- **Location:** [City, Country]
## Professional Summary
[Write a concise 2-4 sentence paragraph about your background, technical expertise, and career goals as a developer]
## Technical Skills
- **Programming Languages:** [e.g., JavaScript, Python, Java, C#, TypeScript]
- **Frontend:** [e.g., React, Vue.js, Angular, HTML5, CSS3, SASS]
- **Backend:** [e.g., Node.js, Django, Flask, Spring Boot, Express.js]
- **Databases:** [e.g., MongoDB, PostgreSQL, MySQL, Firebase]
- **Cloud Services:** [e.g., AWS, Google Cloud, Azure, Heroku]
- **DevOps:** [e.g., Docker, Kubernetes, CI/CD, Jenkins]
- **Testing:** [e.g., Jest, Mocha, Selenium, JUnit]
- **Other Tools:** [e.g., Git, Jira, Figma, Webpack]
## Work Experience
### [Company Name] - [Position Title]
*[Start Date] - [End Date or "Present"]*
- Developed and maintained [specific features or applications] using [technologies]
- Improved [performance/security/user experience] by [specific action], resulting in [measurable outcome]
- Collaborated with cross-functional teams to deliver [project] within [timeframe]
- [Other significant achievements or responsibilities]
### [Company Name] - [Position Title]
*[Start Date] - [End Date]*
- Built [specific features or applications] using [technologies]
- Implemented [specific technical solution] that [solved what problem]
- Participated in code reviews and mentored junior developers
- [Other significant achievements or responsibilities]
## Projects
### [Project Name]
- **Description:** [Brief description of the project and your role]
- **Technologies:** [List of technologies used]
- **Link:** [GitHub repo or live demo]
- **Key Features:**
  - [Feature 1]
  - [Feature 2]
  - [Feature 3]
### [Project Name]
- **Description:** [Brief description of the project and your role]
- **Technologies:** [List of technologies used]
- **Link:** [GitHub repo or live demo]
- **Key Features:**
  - [Feature 1]
  - [Feature 2]
  - [Feature 3]
## Education
### [University/College Name]
- **Degree:** [Bachelor's/Master's/PhD] in [Field of Study]
- **Duration:** [Start Year] - [End Year]
- **Relevant Coursework:** [List relevant courses]
- **GPA:** [Your GPA] (if noteworthy)
## Certifications
- **[Certification Name]** - [Issuing Organization] - [Year]
- **[Certification Name]** - [Issuing Organization] - [Year]
## Additional Experience
- **Open Source Contributions:** [List significant contributions]
- **Hackathons:** [List notable hackathons and achievements]
- **Tech Community:** [Meetups, conferences, or communities you're active in]
- **Technical Writing:** [Any blog posts, tutorials, or documentation you've written]
## Languages
- **English:** [Proficiency level]
- **[Other Language]:** [Proficiency level]
`;

const placeholder = "Enter some rich text...";

const removeStylesExportDOM = (
  editor: LexicalEditor,
  target: LexicalNode
): DOMExportOutput => {
  const output = target.exportDOM(editor);
  if (output && isHTMLElement(output.element)) {
    // Remove all inline styles and classes if the element is an HTMLElement
    // Children are checked as well since TextNode can be nested
    // in i, b, and strong tags.
    for (const el of [
      output.element,
      ...output.element.querySelectorAll('[style],[class],[dir="ltr"]'),
    ]) {
      el.removeAttribute("class");
      el.removeAttribute("style");
      if (el.getAttribute("dir") === "ltr") {
        el.removeAttribute("dir");
      }
    }
  }
  return output;
};

const exportMap: DOMExportOutputMap = new Map<
  Klass<LexicalNode>,
  (editor: LexicalEditor, target: LexicalNode) => DOMExportOutput
>([
  [ParagraphNode, removeStylesExportDOM],
  [TextNode, removeStylesExportDOM],
]);

const getExtraStyles = (element: HTMLElement): string => {
  // Parse styles from pasted input, but only if they match exactly the
  // sort of styles that would be produced by exportDOM
  let extraStyles = "";
  const fontSize = parseAllowedFontSize(element.style.fontSize);
  const backgroundColor = parseAllowedColor(element.style.backgroundColor);
  const color = parseAllowedColor(element.style.color);
  if (fontSize !== "" && fontSize !== "15px") {
    extraStyles += `font-size: ${fontSize};`;
  }
  if (backgroundColor !== "" && backgroundColor !== "rgb(255, 255, 255)") {
    extraStyles += `background-color: ${backgroundColor};`;
  }
  if (color !== "" && color !== "rgb(0, 0, 0)") {
    extraStyles += `color: ${color};`;
  }
  return extraStyles;
};

const constructImportMap = (): DOMConversionMap => {
  const importMap: DOMConversionMap = {};

  // Wrap all TextNode importers with a function that also imports
  // the custom styles implemented by the playground
  for (const [tag, fn] of Object.entries(TextNode.importDOM() || {})) {
    importMap[tag] = (importNode) => {
      const importer = fn(importNode);
      if (!importer) {
        return null;
      }
      return {
        ...importer,
        conversion: (element) => {
          const output = importer.conversion(element);
          if (
            output === null ||
            output.forChild === undefined ||
            output.after !== undefined ||
            output.node !== null
          ) {
            return output;
          }
          const extraStyles = getExtraStyles(element);
          if (extraStyles) {
            const { forChild } = output;
            return {
              ...output,
              forChild: (child, parent) => {
                const textNode = forChild(child, parent);
                if ($isTextNode(textNode)) {
                  textNode.setStyle(textNode.getStyle() + extraStyles);
                }
                return textNode;
              },
            };
          }
          return output;
        },
      };
    };
  }

  return importMap;
};

const editorConfig = {
  html: {
    export: exportMap,
    import: constructImportMap(),
  },
  namespace: "React.js Demo",
  nodes: [
    ParagraphNode,
    TextNode,
    HeadingNode,
    ListNode,
    ListItemNode,
    LinkNode,
    CodeNode,
    QuoteNode,
    MarkNode,
  ],
  onError(error: Error) {
    throw error;
  },
  theme: ExampleTheme,
};

// Component để lấy editor instance
function GetEditorInstance({
  setEditor,
}: {
  setEditor: React.Dispatch<React.SetStateAction<LexicalEditor | null>>;
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    setEditor(editor);
  }, [editor, setEditor]);

  return null;
}

export default function App() {
  const [state, setState] = useState<boolean>(true);
  const [editor, setEditor] = useState<LexicalEditor | null>(null);

  // useEffect(() => {
  //   if (editor) {
  //     editor.update(
  //       () => {
  //         $convertFromMarkdownString(sampleMarkdown, TRANSFORMERS);
  //       },
  //       {
  //         tag: "historic",
  //         discrete: true,
  //       }
  //     );
  //   }
  // }, [editor]);

  const highlightText = (words: string[]) => {
    if (!editor) return;

    // Biến để theo dõi node highlight cuối cùng
    let lastHighlightedNode: LexicalNode | null = null;

    editor.update(
      () => {
        const root = $getRoot();

        // Chỉ xóa highlight cũ, giữ lại các từ đã thay thế
        const removeExistingHighlights = (node: LexicalNode) => {
          if ($isMarkNode(node) && node.getIDs().includes("highlight")) {
            // Lấy nội dung của MarkNode
            const text = node.getTextContent();
            // Tạo TextNode mới không có highlight
            const newTextNode = $createTextNode(text);
            // Thay thế MarkNode bằng TextNode mới
            node.replace(newTextNode);
          } else if ($isElementNode(node)) {
            // Duyệt qua tất cả các node con
            node.getChildren().forEach(removeExistingHighlights);
          }
        };

        // Bắt đầu xóa highlight từ root
        root.getChildren().forEach(removeExistingHighlights);

        // Sau khi đã xóa tất cả highlight, tiếp tục với việc highlight từ mới
        const textNodes: TextNode[] = [];

        // Hàm đệ quy để duyệt qua tất cả các node, bao gồm cả cấu trúc lồng nhau
        const collectTextNodes = (node: LexicalNode) => {
          if ($isTextNode(node)) {
            // Kiểm tra nếu node này đã được thay thế (nằm trong MarkNode với ID 'replaced')
            const parent = node.getParent();
            if ($isMarkNode(parent) && parent.getIDs().includes("replaced")) {
              // Bỏ qua node này vì nó đã được thay thế
              return;
            }
            textNodes.push(node);
          } else if ($isElementNode(node)) {
            // Duyệt qua tất cả các node con
            node.getChildren().forEach(collectTextNodes);
          }
        };

        // Bắt đầu duyệt từ root
        root.getChildren().forEach(collectTextNodes);

        console.log(`Found ${textNodes.length} text nodes`);

        // Process each text node
        textNodes.forEach((textNode, index) => {
          let text = textNode.getTextContent();
          // Thêm thông tin về parent node để dễ debug
          const parentNode = textNode.getParent();
          const parentType = parentNode ? parentNode.getType() : "unknown";

          console.log(`Node #${index + 1}: "${text}" (parent: ${parentType})`);

          let newNodes: LexicalNode[] = [];
          let lastIndex = 0;

          console.log({ text });

          words.forEach((word) => {
            const regex = new RegExp(`\\b${word}\\b`, "gi");
            let match;

            while ((match = regex.exec(text)) !== null) {
              const start = match.index;
              const end = start + word.length;

              // Add text before the match
              if (start > lastIndex) {
                newNodes.push($createTextNode(text.slice(lastIndex, start)));
              }

              // Create text node with the matched word
              const highlightedNode = $createTextNode(text.slice(start, end));

              // Apply styles for visual highlighting (red background)
              highlightedNode.setStyle(
                "background-color: #FF0000; color: white;"
              );

              // Create a MarkNode with the "highlight" ID and wrap the text node
              const markNode = $createMarkNode(["highlight"]);
              markNode.append(highlightedNode);

              // Add the mark node to our array
              newNodes.push(markNode);

              // Lưu lại node highlight cuối cùng
              lastHighlightedNode = markNode;

              lastIndex = end;
            }
          });

          // Add remaining text
          if (lastIndex < text.length) {
            newNodes.push($createTextNode(text.slice(lastIndex)));
          }

          // Replace the original node with new nodes
          if (newNodes.length > 0) {
            textNode.replace(newNodes[0]);
            for (let i = 1; i < newNodes.length; i++) {
              newNodes[i - 1].insertAfter(newNodes[i]);
            }
          }
        });
      },
      {
        onUpdate: () => {
          // Sau khi update hoàn tất, scroll đến node highlight cuối cùng
          if (lastHighlightedNode) {
            setTimeout(() => {
              const domNode = editor.getElementByKey(
                lastHighlightedNode!.getKey()
              );
              if (domNode) {
                // Scroll đến phần tử với hiệu ứng mượt mà
                domNode.scrollIntoView({ behavior: "smooth", block: "center" });
              }
            }, 100); // Đợi một chút để DOM được cập nhật hoàn toàn
          }
        },
      }
    );
  };

  const replaceText = (searchTexts: string[], replaceTexts: string[]) => {
    if (!editor || searchTexts.length !== replaceTexts.length) return;

    // Biến để theo dõi node highlight cuối cùng
    let lastHighlightedNode: LexicalNode | null = null;

    editor.update(
      () => {
        const root = $getRoot();

        // Xóa tất cả các highlight hiện tại trước tiên
        const removeExistingHighlights = (node: LexicalNode) => {
          if ($isMarkNode(node) && (node.getIDs().includes("highlight"))) {
            // Lấy nội dung của MarkNode
            const text = node.getTextContent();
            // Tạo TextNode mới không có highlight
            const newTextNode = $createTextNode(text);
            // Thay thế MarkNode bằng TextNode mới
            node.replace(newTextNode);
          } else if ($isElementNode(node)) {
            // Duyệt qua tất cả các node con
            node.getChildren().forEach(removeExistingHighlights);
          }
        };

        // Bắt đầu xóa highlight từ root
        root.getChildren().forEach(removeExistingHighlights);

        // Thu thập tất cả các TextNode để tìm kiếm và thay thế
        const textNodes: TextNode[] = [];

        // Hàm đệ quy để duyệt qua tất cả các node, bao gồm cả cấu trúc lồng nhau
        const collectTextNodes = (node: LexicalNode) => {
          if ($isTextNode(node)) {
            textNodes.push(node);
          } else if ($isElementNode(node)) {
            // Duyệt qua tất cả các node con
            node.getChildren().forEach(collectTextNodes);
          }
        };

        // Bắt đầu duyệt từ root
        root.getChildren().forEach(collectTextNodes);

        console.log(`Found ${textNodes.length} text nodes for replacement`);

        // Process each text node
        textNodes.forEach((textNode) => {
          let text = textNode.getTextContent();
          let hasChanges = false;
          let newNodes: LexicalNode[] = [];
          let lastIndex = 0;

          // Kiểm tra từng cặp search/replace
          for (let i = 0; i < searchTexts.length; i++) {
            const searchText = searchTexts[i];
            const replaceText = replaceTexts[i];
            const regex = new RegExp(`\\b${searchText}\\b`, "gi");
            
            // Nếu text chứa từ cần tìm
            if (regex.test(text)) {
              hasChanges = true;
              
              // Reset regex để sử dụng lại từ đầu
              regex.lastIndex = 0;
              
              // Biến tạm để xây dựng text mới
              let tempText = text;
              let tempLastIndex = 0;
              let tempNewNodes: LexicalNode[] = [];
              let match;

              while ((match = regex.exec(tempText)) !== null) {
                const start = match.index;
                const end = start + searchText.length;

                // Thêm text trước match
                if (start > tempLastIndex) {
                  tempNewNodes.push($createTextNode(tempText.slice(tempLastIndex, start)));
                }

                // Tạo node cho text đã thay đổi
                const replacedNode = $createTextNode(replaceText);
                
                // Áp dụng style với màu xanh
                replacedNode.setStyle("color: #0000FF; background-color: transparent; font-weight: bold;");

                // Tạo MarkNode với ID "replaced" và bọc TextNode
                const markNode = $createMarkNode(["replaced"]).setStyle("background-color: red;");
                markNode.append(replacedNode);

                // Thêm vào mảng node
                tempNewNodes.push(markNode);

                // Lưu lại node được highlight cuối cùng
                lastHighlightedNode = markNode;

                tempLastIndex = end;
              }

              // Thêm text còn lại
              if (tempLastIndex < tempText.length) {
                tempNewNodes.push($createTextNode(tempText.slice(tempLastIndex)));
              }

              // Cập nhật text và nodes
              newNodes = tempNewNodes;
              break; // Chỉ xử lý 1 lần thay thế
            }
          }

          // Nếu có thay đổi, thay thế node hiện tại
          if (hasChanges && newNodes.length > 0) {
            textNode.replace(newNodes[0]);
            for (let i = 1; i < newNodes.length; i++) {
              newNodes[i - 1].insertAfter(newNodes[i]);
            }
          }
        });
      },
      {
        onUpdate: () => {
          // Sau khi update hoàn tất, scroll đến node đã thay đổi cuối cùng
          if (lastHighlightedNode) {
            setTimeout(() => {
              const domNode = editor.getElementByKey(
                lastHighlightedNode!.getKey()
              );
              if (domNode) {
                // Scroll đến phần tử với hiệu ứng mượt mà
                domNode.scrollIntoView({ behavior: "smooth", block: "center" });
              }
            }, 100);
          }
        },
      }
    );
  };

  return (
    <>
      <h1 style={{ textAlign: "center", margin: "20px 0" }}>
        Lexical Markdown Editor
      </h1>
      <LexicalComposer
        initialConfig={{
          ...editorConfig,
          editorState: () => {
            const state = $convertFromMarkdownString(
              sampleMarkdown,
              TRANSFORMERS
            );
            return state;
          },
          onError(error: Error) {
            throw error;
          },
        }}
      >
        <div className="editor-container">
          <ToolbarPlugin />
          <div className="editor-inner">
            {state ? (
              <RichTextPlugin
                contentEditable={
                  <ContentEditable
                    className="editor-input"
                    aria-placeholder={placeholder}
                    placeholder={
                      <div className="editor-placeholder">{placeholder}</div>
                    }
                  />
                }
                ErrorBoundary={LexicalErrorBoundary}
              />
            ) : (
              <TreeViewPlugin />
            )}

            <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
            <ListPlugin />
            <HistoryPlugin />
            <AutoFocusPlugin />
            {/* Lưu editor instance vào state */}
            {editor === null && <GetEditorInstance setEditor={setEditor} />}
          </div>
        </div>
      </LexicalComposer>

      <div
        style={{
          display: "flex",
          justifyContent: "center",
          gap: "10px",
          margin: "10px 0",
        }}
      >
        <button onClick={() => setState(!state)}>
          {state ? "Tree View" : "Rich Text"}
        </button>

        <button onClick={() => highlightText(["JavaScript"])}>
          Highlight JavaScript
        </button>
        <button onClick={() => highlightText(["Technical Writing"])}>
          Highlight Technical Writing
        </button>

        <button onClick={() => replaceText(["JavaScript"], ["TypeScript"])}>
          Change JavaScript to TypeScript
        </button>
        <button onClick={() => replaceText(["Technical Writing"], ["Technically"])}>
          Change Technical Writing to Technically
        </button>

        <button onClick={() => replaceText(["Technical Writing", "JavaScript"], ["Technically", "TypeScript"])}>
          Change all
        </button>
      </div>
    </>
  );
}
