import NeovimStore from './store';
import * as A from './actions';
import Cursor from './cursor';
import Input from './input';
import log from '../log';

/* Notes on cursor-position to screen coordinates conversion
 * =========================================================
 *
 * Origin is at left-above.
 *
 *          column:
 *      ༒    0 1 2 3 4 5 6 …
 *         .----------------→ x
 *  line 0 | a b c - d e ¬
 *  line 1 | f g ¬
 *  line 3 | 
 *       ︙| 
 *         ↓
 *         y
 *
 *
 */

interface TextRange {
    node: Node;
    offset: number;
    start: number;
    end: number;
    length: number;
}

// Utilities @f

function _ (msg: any): string {
    return JSON.stringify(msg);
}

function splitNodeAt (node: Node, start: number, end: number) {
    const newNode = node.cloneNode();
    newNode.textContent = node.textContent.slice(0, start);
    node.textContent = node.textContent.slice(end);
    node.parentElement.insertBefore(newNode, node);
    log.debug('splitNode:',
              _([0, start]), _(newNode.textContent),
              _([end]), _(node.textContent));
}

function getFontSize(e: HTMLElement): ClientRect {
    const o = document.createElement('span');
    o.style.font = e.style.font;
    o.style.position = 'absolute';
    o.style.whiteSpace = 'nowrap';
    o.style.visibility = 'hidden';
    o.innerText = 'o';
    e.appendChild(o);
    let r = o.getBoundingClientRect();
    o.remove()
    return r;
}

export class TextDisplay {
    // store: NeovimStore,
    // element: HTMLElement;
    container: HTMLElement;
    pointer: HTMLElement;
    cursor: HTMLElement;
    //grid: HTMLElement;
    // cursor: Cursor;
    widthPx: number;
    heightPx: number;

    constructor(private store: NeovimStore, public element: HTMLElement) {
        this.container = document.createElement('div');
        this.container.classList.add('container', 'neovim-editor');
        this.element.appendChild(this.container);

        //this.grid = document.createElement('div');
        //this.grid.classList.add('grid', 'neovim-editor');
        //this.element.appendChild(this.grid);

        this.pointer = document.createElement('div');
        this.pointer.classList.add('overlay', 'neovim-editor');
        this.pointer.style.border   = '1px solid rgb(100,50,255)';
        element.appendChild(this.pointer);

        this.cursor = document.createElement('div');
        this.cursor.classList.add('cursor', 'overlay', 'neovim-editor');
        this.cursor.style.height   = '1em';
        this.cursor.style.width    = '1em';
        this.cursor.style.backgroundColor = 'rgba(100,50,200,0.5)';
        element.appendChild(this.cursor);
        //this.cursor.style.color    = '#efefef';
        //this.cursor.style.border   = '1px solid rgb(100,50,255)';

        // FIXME !
        this.store.on('cursor',    this.updateCursor.bind(this));
        this.store.on('mode',      this.updateMode.bind(this));

        this.store.on('put',       this.insertText.bind(this)     );
        this.store.on('clear-eol', () => this.clearTilEndOfLine() );
        this.store.on('clear-all', () => this.clearDisplay()      );
        this.store.on('update-fg', () => this.updateStyle()       );
        this.store.on('update-sp', () => this.updateStyle()       );
        this.store.on('update-bg', () => {
            this.clearDisplay(); // Note: 'update-bg' clears all texts in screen.
            this.updateStyle();
        });
        this.store.on('line-height-changed', () => {
            this.changeFontSize(this.store.font_attr.specified_px) });

        //this.store.on('scroll-region-updated', this.updateRegionOverlay.bind(this));
        this.store.on('screen-scrolled', this.scroll.bind(this));

        //element.addEventListener('click', this.focus.bind(this));
        element.addEventListener('wheel',     this.onWheel.bind(this));
        element.addEventListener('mousedown', this.onMouseDown.bind(this));
        element.addEventListener('mouseup',   this.onMouseUp.bind(this));
        element.addEventListener('mousemove', this.onMouseMove.bind(this));

        //this.cursor = new Cursor(this.store, this.ctx);
        //this.input  = new Input(this.store);
        this.changeFontSize(this.store.font_attr.specified_px);

        this.updateStyle();
        this.adjustLines();
    }

    onWheel(e: WheelEvent) {
        this.store.dispatcher.dispatch(A.wheelScroll(e));
    }
    onMouseDown(e: MouseEvent) {
        const pos = this.getPositionFrom(e);
        this.store.dispatcher.dispatch(A.dragStart(e));
    }
    onMouseUp(e: MouseEvent) {
        const pos = this.getPositionFrom(e);
        this.store.dispatcher.dispatch(A.dragEnd(e));
    }
    onMouseMove(event: MouseEvent) {

        const pos = this.getPositionFrom(event);

        if (event.buttons !== 0)
            this.store.dispatcher.dispatch(A.dragUpdate(event));

        this.pointer.style.top  = (pos.line * this.heightPx) + 'px';
        this.pointer.style.left = (pos.col *  this.widthPx)  + 'px';
    }

    get line(): Node {
        let lnum = this.store.cursor.line;

        if (lnum >= this.container.children.length)
            this.adjustLines();

        return this.container.children[lnum];
    }

    get lines(): HTMLCollection {
        return this.container.children;
    }

    get position(): [number, number] {
        const {line, col} = this.store.cursor;
        return [line, col];
    }

    get origin(): [number, number] {
        let r = this.container.getBoundingClientRect();
        return [r.left, r.top];
    }

    getLine(n: number): Node {
        if (n >= this.container.children.length)
            this.adjustLines();

        const line = this.container.children.item(n);

        if (line.childElementCount == 0)
            line.appendChild(this.newSpan(null, null));

        return line;
    }

    getCoordsAt (line: number, col: number) {
        return {
            x: col  * this.widthPx,
            y: line * this.heightPx,
            width:    this.widthPx, 
            height:   this.heightPx,
        };
    }

    getPositionAt (x: number, y: number) {
        return {
            line: Math.floor(y * this.heightPx),
            col:  Math.floor(x * this.widthPx),
        };
    }

    getPositionFrom (event: MouseEvent) {
        const {clientX, clientY} = event;
        const o = this.origin;

        let x = clientX - o[0];
        let y = clientY - o[1];

        const line = Math.floor(y / this.heightPx);
        const col  = Math.floor(x / this.widthPx);

        let e = event as any;
        e.line = line;
        e.col  = col;

        return {line, col};
    }

    clearDisplay() {
        let lineNode = this.container.firstChild;
        while (lineNode != null) {
            while (lineNode.firstChild)
                lineNode.removeChild(lineNode.firstChild);
            lineNode = lineNode.nextSibling;
        }
        log.debug('clearDisplay()');
    }

    clearTilEndOfLine () {
        const col = this.store.cursor.col;
        const lineNode = this.line;

        log.debug('clearTilEndOfLine:', _(this.position));

        let count = 0;
        let node = lineNode.firstChild;

        while (node != null) {
            let len = node.textContent.length;

            if (count + len < col) {
                count += len;
                node = node.nextSibling;
                continue;
            }

            if (count + len > col)
                node.textContent = node.textContent.substring(0, col - count);

            break;
        }

        while (node.nextSibling)
            lineNode.removeChild(node.nextSibling);

        if (lineNode.textContent.length < this.store.size.cols) {
            let width = this.store.size.cols - lineNode.textContent.length;
            log.debug('\t: (missing):', width);
            lineNode.appendChild(this.newSpan(" ".repeat(width), null));
        }
    }

    clearEmptyNodes(line?: Node): void {

        if (!line) line = this.line;

        const nodes = line.childNodes;

        for (let i = 0; i < nodes.length; i++) {
            let node = nodes.item(i);

            if (node.textContent.length == 0) {
                log.debug('clearingEmptyNode:', _(this.position));
                line.removeChild(node);
            }
        }
    }

    insertText(chars: string[][]) {
        /*
        * chars: []
        *
        *           col=start            end                  size.cols
        *  [-------------|----------------|-----------------------]
        *                |<-- col_span -->|
        */
        let text  = chars.map(c => c[0]).join("");

        const start = this.store.cursor.col;
        const end   = start + text.length;
        const {line, col} = this.store.cursor;

        log.debug(`insertText(): [${line}, ${col}] - [${line}, ${end}]`, _(text));

        const currentLine = this.line as Element;
        //const range = this.getRange(currentLine, start, end);
        const ra = this.getNodeAt(currentLine, start);
        const rb = this.getNodeAt(currentLine, end);
        const aNode = ra.node;
        const bNode = rb.node;

        let nextNode: Node = null;
        if (aNode == null && bNode == null) {

            let spaces = " ".repeat(start - currentLine.textContent.length);
            const fillNode = this.newSpan(spaces, null)
            currentLine.appendChild(fillNode);

            nextNode = null;

        } else if (bNode == aNode) {
            log.debug('\t: aNode == bNode;', ra, rb);
            splitNodeAt(aNode, ra.offset, rb.offset);
            nextNode = aNode;

        } else if (aNode != bNode && bNode != null) {
            log.debug('\t: aNode != bNode;',
                    _(aNode.textContent),
                    _(bNode.textContent));

            aNode.textContent = aNode.textContent.slice(0, ra.offset);
            bNode.textContent = bNode.textContent.slice(rb.offset);

            while (aNode.nextSibling && aNode.nextSibling != bNode) {
                currentLine.removeChild(aNode.nextSibling);
            }

            nextNode = bNode;

        } else {
            log.debug('\t: aNode != bNode && bNode == null;',
                    _(this.position), _(aNode.textContent));

            aNode.textContent = aNode.textContent.slice(0, ra.offset);

            while (aNode.nextSibling) {
                currentLine.removeChild(aNode.nextSibling);
            }

            nextNode = null;
        }

        const newNode = this.newSpan(text);
        currentLine.insertBefore(newNode, nextNode);

        log.debug('\t: INSERT', _(text), _(this.position),
                  '\t: LINE', _(currentLine.textContent), currentLine.textContent.length);

        this.clearEmptyNodes();

        if (currentLine.textContent.length < this.store.size.cols) {
            let width = this.store.size.cols - currentLine.textContent.length;
            log.debug('\t: (missing):', width);
            currentLine.appendChild(this.newSpan(" ".repeat(width), null));
        }
    }

    changeFontSize(size_px: number) {
        this.container.style.fontSize = size_px + 'px';

        const heightPx = this.store.line_height * size_px;
        const rect     = getFontSize(this.container);
        const widthPx  = rect.width;

        this.widthPx  = widthPx;
        this.heightPx = heightPx;

        this.store.dispatcher.dispatch(A.updateFontPx(size_px));
        this.store.dispatcher.dispatch(
            A.updateFontSize(
                widthPx,
                heightPx,
                widthPx,
                heightPx
            )
        );
        //this.updateStyle();
    }

    changeLineHeight(new_value: number) {
        this.element.style.lineHeight = new_value.toString();
        //this.store.dispatcher.dispatch(A.updateLineHeight(new_value));

        //this.store.line_height = this.store.line_height * new_value + 'px'
        //this.display.style.lineHeight =
            //this.store.line_height * specified_px + 'px';
        this.updateStyle();
    }

    private splitNode(node: Text, offset: number): Node {
        log.debug('splitNode()', offset, _(node.textContent))
        const parent       = node.parentNode;

        if (offset == 0)
            return parent;

        const beforeParent = parent.cloneNode();
        const beforeText   = node.splitText(offset);

        parent.removeChild(beforeText);
        beforeParent.appendChild(beforeText);
        parent.parentNode.insertBefore(beforeParent, parent);

        return beforeParent;
    }

    getRange(container: Element, start: number, end: number) {
        const stop = {};
        const range = document.createRange();
        range.selectNodeContents(container);

        let charIndex  = 0,
            foundStart = false,
            foundEnd   = false,
            lastText: Node;

        const self = this;
        function traverseTextNodes(node: Node) {
            if (node.nodeType == 3) {
                lastText = node;
                let len = node.textContent.length;

                if (!foundStart && ((charIndex + len) > start)) {
                    let offset = start - charIndex;
                    log.debug('getRange(): START:', {start, end, charIndex, offset})
                    if (offset != 0)
                        self.splitNode(<Text>node, offset);
                    range.setStartBefore(node.parentNode);
                    foundStart = true;
                }

                if (foundStart && ((charIndex + len) > end)) {
                    let offset = end - charIndex + 1;

                    log.debug('getRange(): END:', {end, charIndex, offset})

                    let endNode = node.parentNode;

                    if (offset != len)
                        endNode = self.splitNode(<Text>node, offset);

                    range.setEndAfter(endNode);

                    throw stop;
                }

                charIndex += len;

            } else {
                for (var i = 0, len = node.childNodes.length; i < len; ++i) {
                    traverseTextNodes(node.childNodes[i]);
                }
            }
        }

        try {
            traverseTextNodes(container);
        } catch (ex) {
            if (ex != stop) throw ex;
            return range;
        }

        range.setEndAfter(lastText);
        return range;
    }

    getScrollRegionRanges(): Range[] {
        const {top, bottom,
               left, right} = this.store.scroll_region;

        const ranges: Range[] = [];

        log.debug('getScrollRegionRanges():', this.store.scroll_region);
        for (let i = top; i <= bottom; i++) {
            let line = this.getLine(i) as Element;
            ranges.push(
                this.getRange(line, left, right));
        }

        return ranges;
    }

    /*  delta > 0 => screen goes up
     *  delta < 0 => screen goes down
     */
    scroll(delta: number) {
        const {top, bottom,
            left, right} = this.store.scroll_region;
        const width = right - left;

        const ranges = this.getScrollRegionRanges();
        const fragments = ranges.map(r => r.extractContents());

        log.debug(': SCROLL', _(this.store.scroll_region));

        for (let i = 0; i < Math.abs(delta); i++) {

            let frag = document.createDocumentFragment();
            //frag.appendChild(document.createTextNode(""));
            frag.appendChild(this.newSpan(" ".repeat(width), null));

            if (delta > 0) {
                fragments.shift();
                fragments.push(frag);
            } else {
                fragments.pop();
                fragments.unshift(frag);
            }
        }

        for (let i = 0; i < ranges.length; i++) {
            let range = ranges[i];
            range.insertNode(fragments[i]);
            this.clearEmptyNodes(range.commonAncestorContainer);
        }
    }

    updateStyle () {
        const {
            fg_color,
            bg_color,
            font_attr} = this.store;
        const {specified_px} = font_attr;

        //this.widthPx  = font_attr.width;
        const h = this.store.line_height * specified_px;

        this.container.style.color           = fg_color;
        this.container.style.backgroundColor = bg_color;
        this.container.style.fontFamily      = font_attr.face;
        this.container.style.fontSize        = specified_px + 'px';
        this.container.style.lineHeight      = h + 'px';
        this.container.style.minHeight       = h + 'px';

        const rect = getFontSize(this.container);
        //const heightPx = ;
        const widthPx  = rect.width;

        this.pointer.style.width  = font_attr.width  + 'px';
        this.pointer.style.height = font_attr.height + 'px';
        this.cursor.style.width   = font_attr.width  + 'px';
        this.cursor.style.height  = font_attr.height + 'px';
        //this.grid.style.backgroundSize = `${widthPx}px, ${heightPx}px ${heightPx}px`;
    }

    updateMode() {
        //const {line, col} = this.store.cursor;
        const mode = this.store.mode;
        for (let className in this.cursor.classList) {
            if (className.indexOf('-mode') != -1) {
                this.cursor.classList.remove(className);
                break;
            }
        }
        this.cursor.classList.add(mode + '-mode');
        log.debug("updateMode:", _(mode), this.cursor.classList);
    }

    updateCursor() {
        const {line, col} = this.store.cursor;
        this.cursor.style.top  = (line * this.heightPx) + 'px';
        this.cursor.style.left = (col *  this.store.font_attr.width)  + 'px';
    }

    resize (width_px: number, height_px: number) {
        //const h = height_px * this.pixel_ratio;
        //const w = width_px * this.pixel_ratio;
        //const lines = Math.floor(h / this.store.font_attr.draw_height);
        //const cols  = Math.floor(w / this.store.font_attr.draw_width);
        //this.resizeImpl( lines, cols, w, h);
    }

    adjustLines (lines = this.store.size.lines) {
        const children = this.container.children;

        while (children.length < lines) {

            let lineNode = document.createElement('div');
            lineNode.classList.add('line', 'neovim-editor');

            let span = this.newSpan(null, null);

            lineNode.appendChild(span);
            this.container.appendChild(lineNode);

            //fillLine(lineNode, cols);
            log.debug('adjustLines(): added lineNode',
                      lineNode.textContent.length,
                      children.length);
        }

        while (children.length > lines) {
            let node = this.container.lastChild;
            this.container.removeChild(node);
        }

        log.debug('adjustLines(): final children.length:',
                  children.length);
        console.assert(children.length == lines);
    }

    private getNodeAt(lineNode: Node, col: number): TextRange {
        const line = lineNode as HTMLDivElement;

        let charIndex = 0;
        let node = line.firstChild;
        while (node != null) {
            let len = node.textContent.length;

            if (charIndex + len >= col)
                break;

            charIndex += len;
            node = node.nextSibling;
        }

        let len = (node == null) ? 0 : node.textContent.length;

        return {
            node: node,
            offset: col - charIndex,
            start: col,
            end: col + len,
            length: len
        };
    }

    private getCharNodeAt (line: Node, col: number): Node {
        return this.getRange(<Element>line, col, col + 1).startContainer;
    }

    private newSpan(text = "", font_attr = this.store.font_attr): HTMLElement {

        if (text == null)
            text = " ".repeat(this.store.size.cols);

        const span = document.createElement('span');
        span.classList.add('chars', 'neovim-editor');
        span.textContent = text;

        if (font_attr == null)
            return span;

        const {
            fg, bg,
            bold, italic,
            underline, undercurl
        } = font_attr;

        span.style.color = fg;

        if (bg != this.store.bg_color)
            span.style.backgroundColor = bg;

        if (bold)      span.style.fontWeight = 'bold';
        if (italic)    span.style.fontStyle  = 'italic';
        if (underline) span.style.textDecoration = 'underline';
        if (undercurl) span.style.textDecoration = 'undercurl';

        return span;
    }

}

export default class NeovimScreen {
    ctx: CanvasRenderingContext2D;
    txt: TextDisplay;
    display: HTMLElement;
    //cursor: Cursor;
    input:  Input;
    pixel_ratio: number;

    constructor(private store: NeovimStore,
                public canvas: HTMLCanvasElement) {
        this.pixel_ratio = window.devicePixelRatio || 1;
        this.ctx = this.canvas.getContext('2d');

        this.txt = new TextDisplay(store,
            <HTMLElement>document.querySelector('.neovim-display'));

        this.display = this.txt.container;

        //this.store.on('put', this.drawText.bind(this));
        //this.store.on('clear-all', this.clearAll.bind(this));
        //this.store.on('clear-eol', this.clearEol.bind(this));
        // Note: 'update-bg' clears all texts in screen.
        //this.store.on('update-bg', this.clearAll.bind(this));
        //this.store.on('screen-scrolled', this.scroll.bind(this));
        //this.store.on('line-height-changed', () => this.changeFontSize(this.store.font_attr.specified_px));
        this.changeFontSize(this.store.font_attr.specified_px);

        canvas.addEventListener('click', this.focus.bind(this));
        canvas.addEventListener('mousedown', this.mouseDown.bind(this));
        canvas.addEventListener('mouseup', this.mouseUp.bind(this));
        canvas.addEventListener('mousemove', this.mouseMove.bind(this));
        canvas.addEventListener('wheel', this.wheel.bind(this));

        //this.cursor = new Cursor(this.store, this.ctx);
        this.input = new Input(this.store);
    }

    convertPositionToLocation(line: number, col: number) {
        const {width, height} = this.store.font_attr;
        return {
            x: col * width,
            y: line * height,
        };
    }
    convertLocationToPosition(x: number, y: number) {
        const {width, height} = this.store.font_attr;
        return {
            line: Math.floor(y * height),
            col: Math.floor(x * width),
        };
    }
    checkShouldResize() {
        const p = this.canvas.parentElement;
        const cw = p.clientWidth;
        const ch = p.clientHeight;
        const w = this.canvas.width;
        const h = this.canvas.height;
        if (cw * this.pixel_ratio !== w ||
            ch * this.pixel_ratio !== h) {
            this.resizeWithPixels(cw, ch);
        }
    }

    wheel(e: WheelEvent) {
        this.store.dispatcher.dispatch(A.wheelScroll(e));
    }
    mouseDown(e: MouseEvent) {
        this.store.dispatcher.dispatch(A.dragStart(e));
    }
    mouseUp(e: MouseEvent) {
        this.store.dispatcher.dispatch(A.dragEnd(e));
    }
    mouseMove(e: MouseEvent) {
        if (e.buttons !== 0) {
            this.store.dispatcher.dispatch(A.dragUpdate(e));
        }
    }

    resizeWithPixels(width_px: number, height_px: number) {
        const h = height_px * this.pixel_ratio;
        const w = width_px * this.pixel_ratio;
        const lines = Math.floor(h / this.store.font_attr.draw_height);
        const cols = Math.floor(w / this.store.font_attr.draw_width);
        this.resizeImpl( lines, cols, w, h);
    }

    resize(lines: number, cols: number) {
        this.resizeImpl(
                lines,
                cols,
                this.store.font_attr.draw_width * cols,
                this.store.font_attr.draw_height * lines
            );
    }

    changeFontSize(specified_px: number) {

        const drawn_px = specified_px * this.pixel_ratio;

        this.ctx.font = drawn_px + 'px ' + this.store.font_attr.face;

        const font_width = this.ctx.measureText('m').width;
        // Note1:
        // Line height of <canvas> is fixed to 1.2 (normal).
        // If the specified line height is not 1.2, we should calculate
        // the line height manually.
        //
        // Note2:
        // font_width is not passed to Math.ceil() because the line-height
        // of <canvas> is fixed to 1.2.  Math.ceil(font_width) makes region
        // wider but width of actual rendered text is not changed.  Then it
        // causes rendering issues.
        // On the other hand, line-height is managed by us completely.  So
        // we can use Math.ceil(font_height) at this point and it resolves
        // some rendering issues (see #12).
        const font_height = Math.ceil(
            this.store.line_height === 1.2 ?
                font_width * 2 :
                drawn_px * this.store.line_height
        );

        this.store.dispatcher.dispatch(A.updateFontPx(specified_px));
        this.store.dispatcher.dispatch(
            A.updateFontSize(
                font_width,
                font_height,
                font_width / this.pixel_ratio,
                font_height / this.pixel_ratio
            )
        );
        const {width, height} = this.store.size;
        this.resizeWithPixels(width, height);
    }

    changeLineHeight(new_value: number) {
        this.store.dispatcher.dispatch(A.updateLineHeight(new_value));
    }

    /* Note:
     *  cols_delta > 0 -> screen up
     *  cols_delta < 0 -> screen down */
    scroll(cols_delta: number) { 
        if (cols_delta > 0) {
            this.scrollUp(cols_delta);
        } else if (cols_delta < 0) {
            this.scrollDown(-cols_delta);
        }
    }
    focus() {
        this.input.focus();
    }

    clearAll() {
        this.ctx.fillStyle = this.store.bg_color;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    clearEol() {
        const {line, col} = this.store.cursor;
        const font_width = this.store.font_attr.draw_width;
        const clear_length = this.store.size.cols * font_width - col * font_width;
        log.debug(`Clear until EOL: ${line}:${col} length=${clear_length}`);
        this.drawBlock(line, col, 1, clear_length, this.store.bg_color);
    }

    /* Note:
     * About 'chars' parameter includes characters to render as array of strings
     * which should be rendered at the each cursor position.
     * So we renders the strings with forwarding the start position incrementally.
     * When chars[idx][0] is empty string, it means that 'no character to render,
     * go ahead'.
     */
    private drawChars(x: number, y: number, chars: string[][], width: number) {
        let includes_half_only = true;
        for (const c of chars) {
            if (!c[0]) {
                includes_half_only = false;
                break;
            }
        }
        if (includes_half_only) {
            // Note: If the text includes only half characters, we can render it at once.
            const text = chars.map(c => (c[0] || '')).join('');
            this.ctx.fillText(text, x, y);
            return;
        }

        for (const char of chars) {
            if (!char[0] || char[0] === ' ') {
                x += width;
                continue;
            }
            this.ctx.fillText(char.join(''), x, y);
            x += width;
        }
    }
    private drawText(chars: string[][]) {
        const {line, col} = this.store.cursor;
        const {
            fg, bg,
            draw_width,
            draw_height,
            face,
            specified_px,
            bold,
            italic,
            underline,
        } = this.store.font_attr;
        const font_size = specified_px * this.pixel_ratio;

        this.drawBlock(line, col, 1, chars.length, bg);

        let attrs = '';
        if (bold) {
            attrs += 'bold ';
        }
        if (italic) {
            attrs += 'italic ';
        }
        this.ctx.font = attrs + font_size + 'px ' + face;
        this.ctx.textBaseline = 'top';
        this.ctx.fillStyle = fg;
        // Note:
        // Line height of <canvas> is fixed to 1.2 (normal).
        // If the specified line height is not 1.2, we should calculate
        // the difference of margin-bottom of text.
        const margin = font_size * (this.store.line_height - 1.2) / 2;
        const y = Math.floor(line * draw_height + margin);
        const x = col * draw_width;

        this.drawChars(x, y, chars, draw_width);

        if (underline) {
            this.ctx.strokeStyle = fg;
            this.ctx.lineWidth = 1 * this.pixel_ratio;
            this.ctx.beginPath();
            // Note:
            // 3 is set with considering the width of line.
            const underline_y = y + draw_height - 3 * this.pixel_ratio;
            this.ctx.moveTo(x, underline_y);
            this.ctx.lineTo(x + draw_width * chars.length, underline_y);
            this.ctx.stroke();
        }
    }

    private drawBlock(line: number, col: number, height: number, width: number, color: string) {
        const {draw_width, draw_height} = this.store.font_attr;
        this.ctx.fillStyle = color;
        // Note:
        // Height doesn't need to be truncated (floor, ceil) but width needs.
        // The reason is desribed in Note2 of changeFontSize().
        this.ctx.fillRect(
                Math.floor(col * draw_width),
                line * draw_height,
                Math.ceil(width * draw_width),
                height * draw_height
            );
    }

    private slideVertical(top: number, height: number, dst_top: number) {
        const {left, right} = this.store.scroll_region;
        const {draw_width, draw_height} = this.store.font_attr;
        const captured
            = this.ctx.getImageData(
                left * draw_width,
                top * draw_height,
                (right - left + 1) * draw_width,
                height * draw_height
            );
        this.ctx.putImageData(
            captured,
            left * draw_width,
            dst_top * draw_height
        );
    }
    private scrollUp(cols_up: number) {
        const {top, bottom, left, right} = this.store.scroll_region;
        this.slideVertical(
            top + cols_up,
            bottom - (top + cols_up) + 1,
            top
        );
        this.drawBlock(
            bottom - cols_up + 1,
            left,
            cols_up,
            right - left + 1,
            this.store.bg_color
        );
        log.debug('Scroll up: ' + cols_up, this.store.scroll_region);
    }
    private scrollDown(cols_down: number) {
        const {top, bottom, left, right} = this.store.scroll_region;
        this.slideVertical(
            top,
            bottom - (top + cols_down) + 1,
            top + cols_down
        );
        this.drawBlock(
            top,
            left,
            cols_down,
            right - left + 1,
            this.store.bg_color
        );
        log.debug('Scroll down: ' + cols_down, this.store.scroll_region);
    }

    private resizeImpl(lines: number, cols: number, width: number, height: number) {

        if (width !== this.canvas.width) {
            this.canvas.width = width;
            this.canvas.style.width = (width / this.pixel_ratio) + 'px';

        }
        if (height !== this.canvas.height) {
            this.canvas.height = height;
            this.canvas.style.height = (height / this.pixel_ratio) + 'px';
        }

        this.store.dispatcher.dispatch(A.updateScreenSize(width, height));
        this.store.dispatcher.dispatch(A.updateScreenBounds(lines, cols));

        this.txt.adjustLines();
    }
}
