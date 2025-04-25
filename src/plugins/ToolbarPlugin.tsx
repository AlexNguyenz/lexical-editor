/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { mergeRegister } from "@lexical/utils";
import {
  $getSelection,
  $isRangeSelection,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  FORMAT_ELEMENT_COMMAND,
  FORMAT_TEXT_COMMAND,
  REDO_COMMAND,
  SELECTION_CHANGE_COMMAND,
  UNDO_COMMAND,
  TextNode,
  LexicalNode,
} from "lexical";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  $isListNode,
  $createListNode,
  $createListItemNode,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  REMOVE_LIST_COMMAND,
  ListNode,
} from "@lexical/list";
import { $findMatchingParent, $getNearestNodeOfType } from "@lexical/utils";

const LowPriority = 1;

// Font sizes options
const FONT_SIZE_OPTIONS: [string, string][] = [
  ["10px", "10px"],
  ["11px", "11px"],
  ["12px", "12px"],
  ["13px", "13px"],
  ["14px", "14px"],
  ["15px", "15px"],
  ["16px", "16px"],
  ["17px", "17px"],
  ["18px", "18px"],
  ["19px", "19px"],
  ["20px", "20px"],
  ["24px", "24px"],
  ["30px", "30px"],
  ["36px", "36px"],
  ["48px", "48px"],
  ["60px", "60px"],
  ["72px", "72px"],
];

// Font families options
const FONT_FAMILY_OPTIONS: [string, string][] = [
  ["Arial", "Arial, sans-serif"],
  ["Courier New", "Courier New, monospace"],
  ["Georgia", "Georgia, serif"],
  ["Times New Roman", "Times New Roman, serif"],
  ["Trebuchet MS", "Trebuchet MS, sans-serif"],
  ["Verdana", "Verdana, sans-serif"],
];

// Color options
const COLOR_OPTIONS: [string, string][] = [
  ["Black", "#000000"],
  ["Red", "#FF0000"],
  ["Orange", "#FFA500"],
  ["Yellow", "#FFFF00"],
  ["Green", "#00FF00"],
  ["Blue", "#0000FF"],
  ["Purple", "#800080"],
  ["Gray", "#808080"],
];

function Divider() {
  return <div className="divider" />;
}

interface SelectProps {
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  options: [string, string][];
  value: string;
  disabled?: boolean;
  label?: string;
}

function Select({
  onChange,
  options,
  value,
  disabled = false,
  label,
}: SelectProps) {
  return (
    <div className="toolbar-item toolbar-select">
      {label && <span className="toolbar-item-label">{label}</span>}
      <select
        disabled={disabled}
        onChange={onChange}
        value={value}
        title={label}
      >
        {options.map(([name, value]) => (
          <option key={value} value={value}>
            {name}
          </option>
        ))}
      </select>
    </div>
  );
}

export default function ToolbarPlugin() {
  const [editor] = useLexicalComposerContext();
  const toolbarRef = useRef(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [isUnderline, setIsUnderline] = useState(false);
  const [isStrikethrough, setIsStrikethrough] = useState(false);
  const [fontSize, setFontSize] = useState("15px");
  const [fontFamily, setFontFamily] = useState("Arial, sans-serif");
  const [fontColor, setFontColor] = useState("#000000");
  const [isOrderedList, setIsOrderedList] = useState(false);
  const [isUnorderedList, setIsUnorderedList] = useState(false);

  const $updateToolbar = useCallback(() => {
    const selection = $getSelection();
    if ($isRangeSelection(selection)) {
      // Update text format
      setIsBold(selection.hasFormat("bold"));
      setIsItalic(selection.hasFormat("italic"));
      setIsUnderline(selection.hasFormat("underline"));
      setIsStrikethrough(selection.hasFormat("strikethrough"));

      // Get font size, font family, and color
      const node = selection.getNodes()[0];
      if (node instanceof TextNode) {
        // Check style attribute to get font size and color
        const styleString = node.getStyle();
        if (styleString) {
          // Extract font size
          const fontSizeMatch = styleString.match(/font-size:\s*([^;]+)/);
          if (fontSizeMatch && fontSizeMatch[1]) {
            setFontSize(fontSizeMatch[1]);
          } else {
            setFontSize("15px"); // Default
          }

          // Extract font family
          const fontFamilyMatch = styleString.match(/font-family:\s*([^;]+)/);
          if (fontFamilyMatch && fontFamilyMatch[1]) {
            setFontFamily(fontFamilyMatch[1]);
          } else {
            setFontFamily("Arial, sans-serif"); // Default
          }

          // Extract color
          const colorMatch = styleString.match(/color:\s*([^;]+)/);
          if (colorMatch && colorMatch[1]) {
            setFontColor(colorMatch[1]);
          } else {
            setFontColor("#000000"); // Default black
          }
        }
      }

      // Kiểm tra danh sách bằng $findMatchingParent để tìm node cha gần nhất khớp với điều kiện
      const anchorNode = selection.anchor.getNode();
      const listNode = $findMatchingParent(anchorNode, $isListNode);

      if (listNode && $isListNode(listNode)) {
        const listType = listNode.getListType();
        setIsOrderedList(listType === "number");
        setIsUnorderedList(listType === "bullet");
      } else {
        setIsOrderedList(false);
        setIsUnorderedList(false);
      }
    }
  }, []);

  useEffect(() => {
    return mergeRegister(
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          $updateToolbar();
        });
      }),
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        (_payload, _newEditor) => {
          $updateToolbar();
          return false;
        },
        LowPriority
      ),
      editor.registerCommand(
        CAN_UNDO_COMMAND,
        (payload) => {
          setCanUndo(payload);
          return false;
        },
        LowPriority
      ),
      editor.registerCommand(
        CAN_REDO_COMMAND,
        (payload) => {
          setCanRedo(payload);
          return false;
        },
        LowPriority
      )
    );
  }, [editor, $updateToolbar]);

  const onFontSizeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const fontSize = e.target.value;
      setFontSize(fontSize);

      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          selection.getNodes().forEach((node) => {
            if (node instanceof TextNode) {
              const currentStyle = node.getStyle() || "";
              // Kiểm tra xem style hiện tại đã có font-size chưa
              const fontSizePattern = /font-size:\s*([^;]+)(;|$)/;
              let newStyle;

              if (fontSizePattern.test(currentStyle)) {
                // Nếu đã có font-size, thay thế nó
                newStyle = currentStyle.replace(
                  fontSizePattern,
                  `font-size: ${fontSize}$2`
                );
              } else {
                // Nếu chưa có, thêm mới
                newStyle =
                  currentStyle +
                  (currentStyle && !currentStyle.endsWith(";") ? ";" : "") +
                  `font-size: ${fontSize};`;
              }

              node.setStyle(newStyle);
            }
          });
        }
      });
    },
    [editor]
  );

  const onFontFamilyChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const fontFamily = e.target.value;
      setFontFamily(fontFamily);

      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          selection.getNodes().forEach((node) => {
            if (node instanceof TextNode) {
              const currentStyle = node.getStyle() || "";
              // Kiểm tra xem style hiện tại đã có font-family chưa
              const fontFamilyPattern = /font-family:\s*([^;]+)(;|$)/;
              let newStyle;

              if (fontFamilyPattern.test(currentStyle)) {
                // Nếu đã có font-family, thay thế nó
                newStyle = currentStyle.replace(
                  fontFamilyPattern,
                  `font-family: ${fontFamily}$2`
                );
              } else {
                // Nếu chưa có, thêm mới
                newStyle =
                  currentStyle +
                  (currentStyle && !currentStyle.endsWith(";") ? ";" : "") +
                  `font-family: ${fontFamily};`;
              }

              node.setStyle(newStyle);
            }
          });
        }
      });
    },
    [editor]
  );

  const onFontColorChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const color = e.target.value;
      setFontColor(color);

      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          selection.getNodes().forEach((node) => {
            if (node instanceof TextNode) {
              const currentStyle = node.getStyle() || "";
              // Kiểm tra xem style hiện tại đã có color chưa
              const colorPattern = /color:\s*([^;]+)(;|$)/;
              let newStyle;

              if (colorPattern.test(currentStyle)) {
                // Nếu đã có color, thay thế nó
                newStyle = currentStyle.replace(
                  colorPattern,
                  `color: ${color}$2`
                );
              } else {
                // Nếu chưa có, thêm mới
                newStyle =
                  currentStyle +
                  (currentStyle && !currentStyle.endsWith(";") ? ";" : "") +
                  `color: ${color};`;
              }

              node.setStyle(newStyle);
            }
          });
        }
      });
    },
    [editor]
  );

  return (
    <div className="toolbar" ref={toolbarRef}>
      <button
        disabled={!canUndo}
        onClick={() => {
          editor.dispatchCommand(UNDO_COMMAND, undefined);
        }}
        className="toolbar-item spaced"
        aria-label="Undo"
      >
        <i className="format undo" />
      </button>
      <button
        disabled={!canRedo}
        onClick={() => {
          editor.dispatchCommand(REDO_COMMAND, undefined);
        }}
        className="toolbar-item"
        aria-label="Redo"
      >
        <i className="format redo" />
      </button>
      <Divider />
      {/* Font family, size, and color */}
      <Select
        label="Font"
        options={FONT_FAMILY_OPTIONS}
        value={fontFamily}
        onChange={onFontFamilyChange}
      />
      <Select
        label="Size"
        options={FONT_SIZE_OPTIONS}
        value={fontSize}
        onChange={onFontSizeChange}
      />
      <Select
        label="Color"
        options={COLOR_OPTIONS}
        value={fontColor}
        onChange={onFontColorChange}
      />
      <Divider />
      {/* Text formatting */}
      <button
        onClick={() => {
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold");
        }}
        className={"toolbar-item spaced " + (isBold ? "active" : "")}
        aria-label="Format Bold"
      >
        <i className="format bold" />
      </button>
      <button
        onClick={() => {
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic");
        }}
        className={"toolbar-item spaced " + (isItalic ? "active" : "")}
        aria-label="Format Italics"
      >
        <i className="format italic" />
      </button>
      <button
        onClick={() => {
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, "underline");
        }}
        className={"toolbar-item spaced " + (isUnderline ? "active" : "")}
        aria-label="Format Underline"
      >
        <i className="format underline" />
      </button>
      <button
        onClick={() => {
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, "strikethrough");
        }}
        className={"toolbar-item spaced " + (isStrikethrough ? "active" : "")}
        aria-label="Format Strikethrough"
      >
        <i className="format strikethrough" />
      </button>
      <Divider />
      {/* Lists */}
      <button
        onClick={() => {
          if (isUnorderedList) {
            // Nếu đã là unordered list, khi click lại sẽ remove list
            editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
          } else {
            // Nếu chưa phải unordered list hoặc là ordered list, chuyển sang unordered list
            editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
          }
        }}
        className={"toolbar-item spaced " + (isUnorderedList ? "active" : "")}
        aria-label="Bullet List"
      >
        <i className="format bullet-list" />
      </button>
      <button
        onClick={() => {
          if (isOrderedList) {
            // Nếu đã là ordered list, khi click lại sẽ remove list
            editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
          } else {
            // Nếu chưa phải ordered list hoặc là unordered list, chuyển sang ordered list
            editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
          }
        }}
        className={"toolbar-item spaced " + (isOrderedList ? "active" : "")}
        aria-label="Ordered List"
      >
        <i className="format numbered-list" />
      </button>
      <Divider />
      {/* Alignment */}
      <button
        onClick={() => {
          editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, "left");
        }}
        className="toolbar-item spaced"
        aria-label="Left Align"
      >
        <i className="format left-align" />
      </button>
      <button
        onClick={() => {
          editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, "center");
        }}
        className="toolbar-item spaced"
        aria-label="Center Align"
      >
        <i className="format center-align" />
      </button>
      <button
        onClick={() => {
          editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, "right");
        }}
        className="toolbar-item spaced"
        aria-label="Right Align"
      >
        <i className="format right-align" />
      </button>
      <button
        onClick={() => {
          editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, "justify");
        }}
        className="toolbar-item"
        aria-label="Justify Align"
      >
        <i className="format justify-align" />
      </button>{" "}
    </div>
  );
}
