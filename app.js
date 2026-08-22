import { Chess } from "./vendor/chess.js";

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const RANKS = "87654321";
const AI_SEARCH_MAX_DEPTH = 3;
const AI_SEARCH_TIME_MS = 1500;
const AI_MOVE_DELAY_MS = 320;
const AI_MOVE_HARD_TIMEOUT_MS = 5000;
const AI_SEARCH_YIELD_EVERY_NODES = 128;
const AI_NEAR_BEST_MARGIN = 90;
const AI_SEARCH_TIMEOUT = Symbol("AI_SEARCH_TIMEOUT");
const MOVE_ANIMATION_MS = 150;
const AudioContextClass = window.AudioContext || window.webkitAudioContext;
let audioContext = null;
const moveAnimationSnapshots = new WeakMap();
const PIECE_IMAGES = {
  p: { w: "./assets/pieces/white_pawn.svg", b: "./assets/pieces/black_pawn.svg" },
  r: { w: "./assets/pieces/white_rook.svg", b: "./assets/pieces/black_rook.svg" },
  n: { w: "./assets/pieces/white_knight.svg", b: "./assets/pieces/black_knight.svg" },
  b: { w: "./assets/pieces/white_bishop.svg", b: "./assets/pieces/black_bishop.svg" },
  q: { w: "./assets/pieces/white_queen.svg", b: "./assets/pieces/black_queen.svg" },
  k: { w: "./assets/pieces/white_king.svg", b: "./assets/pieces/black_king.svg" },
};

const game = new Chess();
const state = {
  mode: null,
  humanColor: "w",
  selected: null,
  legalMoves: [],
  pendingPromotion: null,
  aiThinking: false,
  aiJobId: 0,
  animating: false,
  winner: null,
};

const landingEl = document.getElementById("landing");
const gameViewEl = document.getElementById("gameView");
const boardEl = document.getElementById("board");
const statusText = document.getElementById("statusText");
const undoBtn = document.getElementById("undoBtn");
const resetBtn = document.getElementById("resetBtn");
const backBtn = document.getElementById("backBtn");
const startHumanBtn = document.getElementById("startHumanBtn");
const startAiBtn = document.getElementById("startAiBtn");
const startAiWhiteBtn = document.getElementById("startAiWhiteBtn");
const startAiBlackBtn = document.getElementById("startAiBlackBtn");
const historyList = document.getElementById("historyList");
const bottomFiles = document.getElementById("bottomFiles");
const leftRanks = document.getElementById("leftRanks");
const promotionModal = document.getElementById("promotionModal");
const promotionOptions = document.getElementById("promotionOptions");
const colorModal = document.getElementById("colorModal");
const aboutContent = document.getElementById("aboutContent");
const copyrightYear = document.getElementById("copyrightYear");
const siteFooter = document.querySelector(".site-footer");

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderInlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

function renderMarkdown(markdown) {
  const html = [];
  let listOpen = false;

  const closeList = () => {
    if (listOpen) {
      html.push("</ul>");
      listOpen = false;
    }
  };

  for (const sourceLine of markdown.split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line) {
      closeList();
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = Math.min(heading[1].length + 1, 4);
      html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const listItem = line.match(/^[-*]\s+(.+)$/);
    if (listItem) {
      if (!listOpen) {
        html.push("<ul>");
        listOpen = true;
      }
      html.push(`<li>${renderInlineMarkdown(listItem[1])}</li>`);
      continue;
    }

    closeList();
    html.push(`<p>${renderInlineMarkdown(line)}</p>`);
  }

  closeList();
  return html.join("");
}

async function loadAboutContent() {
  try {
    const response = await fetch("./about.md", { cache: "no-cache" });
    if (!response.ok) {
      throw new Error(`Unable to load about.md (${response.status})`);
    }
    aboutContent.innerHTML = renderMarkdown(await response.text());
  } catch (error) {
    console.error(error);
    aboutContent.innerHTML = '<p class="about-error">About information is currently unavailable.</p>';
  }
}

function unlockAudio() {
  if (!AudioContextClass) return;
  audioContext ||= new AudioContextClass();
  if (audioContext.state === "suspended") audioContext.resume().catch(() => {});
}

function playMoveSound(isCapture) {
  if (!AudioContextClass) return;
  unlockAudio();
  if (!audioContext || audioContext.state !== "running") return;

  const now = audioContext.currentTime;

  if (isCapture) {
    const master = audioContext.createGain();
    master.gain.setValueAtTime(0.68, now);
    master.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    master.connect(audioContext.destination);

    // A capture is two tightly layered, bright clicks instead of one heavy thud.
    for (const [offset, pitch, volume] of [[0, 1, 1], [0.055, 1.12, 0.82]]) {
      const start = now + offset;
      const noiseLength = Math.floor(audioContext.sampleRate * 0.022);
      const noiseBuffer = audioContext.createBuffer(1, noiseLength, audioContext.sampleRate);
      const noise = noiseBuffer.getChannelData(0);
      for (let i = 0; i < noiseLength; i++) {
        const envelope = Math.pow(1 - i / noiseLength, 5);
        noise[i] = (Math.random() * 2 - 1) * envelope;
      }

      const noiseSource = audioContext.createBufferSource();
      const noiseFilter = audioContext.createBiquadFilter();
      const noiseGain = audioContext.createGain();
      noiseSource.buffer = noiseBuffer;
      noiseFilter.type = "highpass";
      noiseFilter.frequency.setValueAtTime(2400, start);
      noiseFilter.Q.setValueAtTime(0.8, start);
      noiseGain.gain.setValueAtTime(0.42 * volume, start);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, start + 0.022);
      noiseSource.connect(noiseFilter).connect(noiseGain).connect(master);
      noiseSource.start(start);

      for (const [frequency, toneVolume, duration] of [[1320, 0.28, 0.07], [1980, 0.16, 0.045]]) {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(frequency * pitch, start);
        oscillator.frequency.exponentialRampToValueAtTime(frequency * pitch * 1.08, start + duration);
        gain.gain.setValueAtTime(toneVolume * volume, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
        oscillator.connect(gain).connect(master);
        oscillator.start(start);
        oscillator.stop(start + duration);
      }
    }
    return;
  }

  const master = audioContext.createGain();
  master.gain.setValueAtTime(0.72, now);
  master.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
  master.connect(audioContext.destination);

  const noiseLength = Math.floor(audioContext.sampleRate * 0.035);
  const noiseBuffer = audioContext.createBuffer(1, noiseLength, audioContext.sampleRate);
  const noise = noiseBuffer.getChannelData(0);
  for (let i = 0; i < noiseLength; i++) {
    const envelope = Math.pow(1 - i / noiseLength, 3);
    noise[i] = (Math.random() * 2 - 1) * envelope;
  }
  const noiseSource = audioContext.createBufferSource();
  const noiseFilter = audioContext.createBiquadFilter();
  noiseSource.buffer = noiseBuffer;
  noiseFilter.type = "bandpass";
  noiseFilter.frequency.setValueAtTime(1850, now);
  noiseFilter.Q.setValueAtTime(0.9, now);
  noiseSource.connect(noiseFilter).connect(master);
  noiseSource.start(now);

  const tones = [[235, 0.42, 0.12], [510, 0.18, 0.07]];
  for (const [frequency, volume, duration] of tones) {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.82, now + duration);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    oscillator.connect(gain).connect(master);
    oscillator.start(now);
    oscillator.stop(now + duration);
  }
}

function algebraicToCoords(square) {
  return {
    file: square.charCodeAt(0) - 97,
    rank: Number(square[1]) - 1,
  };
}

function coordsToAlgebraic(file, rank) {
  return `${FILES[file]}${rank + 1}`;
}

function internalSquareToAlgebraic(square) {
  return `${FILES[square & 7]}${RANKS[square >> 4]}`;
}

function internalMoveToText(move) {
  const piece = (move.piece || "?").toUpperCase();
  const capture = move.captured ? "x" : "-";
  const promotion = move.promotion ? `=${move.promotion.toUpperCase()}` : "";
  return `${piece} ${internalSquareToAlgebraic(move.from)}${capture}${internalSquareToAlgebraic(move.to)}${promotion}`;
}

function buildAxes() {
  bottomFiles.innerHTML = "";
  leftRanks.innerHTML = "";

  FILES.forEach((file) => {
    const bottom = document.createElement("span");
    bottom.textContent = file;
    bottomFiles.appendChild(bottom);
  });

  for (let rank = 8; rank >= 1; rank -= 1) {
    const left = document.createElement("span");
    left.textContent = rank;
    leftRanks.appendChild(left);
  }
}

function buildBoard() {
  boardEl.innerHTML = "";
  for (let rank = 7; rank >= 0; rank -= 1) {
    for (let file = 0; file < 8; file += 1) {
      const square = coordsToAlgebraic(file, rank);
      const squareEl = document.createElement("button");
      squareEl.type = "button";
      squareEl.className = `square ${(file + rank) % 2 === 0 ? "light" : "dark"}`;
      squareEl.dataset.square = square;
      squareEl.addEventListener("click", () => onSquareClick(square));
      boardEl.appendChild(squareEl);
    }
  }
}

function clearSelection() {
  state.selected = null;
  state.legalMoves = [];
}

function clearPromotion() {
  state.pendingPromotion = null;
  promotionModal.classList.add("is-hidden");
  promotionOptions.innerHTML = "";
}

function showColorPicker() {
  colorModal.classList.remove("is-hidden");
  startAiWhiteBtn.focus();
}

function clearColorPicker() {
  colorModal.classList.add("is-hidden");
  startAiBtn.focus();
}

function clearWinner() {
  state.winner = null;
}

function getAiColor() {
  return state.mode === "ai" ? (state.humanColor === "w" ? "b" : "w") : null;
}

function shouldRotateBlackPieces() {
  return state.mode === "human" && window.matchMedia("(pointer: coarse)").matches;
}

function isGameOver() {
  return Boolean(state.winner);
}

function getUndoCount() {
  return state.mode === "ai" ? 2 : 1;
}

function canUndo() {
  const isHumanTurn = state.mode !== "ai" || game.turn() === state.humanColor;
  return !state.aiThinking && !state.animating && !isGameOver()
    && isHumanTurn && game._history.length >= getUndoCount();
}

function getTurnLabel() {
  return game.turn() === "w" ? "White" : "Black";
}

function legalMovesFrom(square) {
  return game
    ._moves({ legal: false, square })
    .map((move) => ({ square: internalSquareToAlgebraic(move.to), capture: Boolean(move.captured) }));
}

function isPromotionMove(from, to) {
  const piece = game.get(from);
  if (!piece || piece.type !== "p") {
    return false;
  }

  const targetRank = Number(to[1]);
  return (piece.color === "w" && targetRank === 8) || (piece.color === "b" && targetRank === 1);
}

function getPromotionColor() {
  if (state.pendingPromotion) {
    const pendingPiece = game.get(state.pendingPromotion.from);
    return (pendingPiece && pendingPiece.color) || game.turn();
  }

  if (state.mode === "ai") {
    return getAiColor() === "w" ? "w" : "b";
  }

  return game.turn();
}

function hasKing(color) {
  return game.board().some((row) => row.some((piece) => piece && piece.type === "k" && piece.color === color));
}

function showPromotionPicker(from, to) {
  state.pendingPromotion = { from, to };
  promotionOptions.innerHTML = "";

  const promotionPieces = ["q", "r", "b", "n"];
  const color = getPromotionColor();

  for (const pieceType of promotionPieces) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "promotion-option";
    button.dataset.piece = pieceType;

    const image = document.createElement("img");
    image.src = PIECE_IMAGES[pieceType][color];
    image.alt = `${color === "w" ? "White" : "Black"} ${pieceType}`;

    const label = document.createElement("span");
    label.textContent = pieceType.toUpperCase();

    button.append(image, label);
    button.addEventListener("click", () => finalizePromotion(pieceType));
    promotionOptions.appendChild(button);
  }

  promotionModal.classList.remove("is-hidden");
}

async function finalizePromotion(promotion) {
  if (!state.pendingPromotion) {
    return;
  }

  const { from, to } = state.pendingPromotion;
  const move = executePseudoMove(from, to, promotion);
  clearPromotion();

  if (!move) {
    return;
  }

  clearSelection();
  await animateCommittedMove(move);
  maybeRunAiMove();
}

function renderHistory() {
  const history = game._history.map((entry) => entry.move);
  const previousMoveCount = Number(historyList.dataset.moveCount || 0);
  const historyChanged = history.length !== previousMoveCount;
  historyList.innerHTML = "";
  historyList.dataset.moveCount = String(history.length);

  if (historyChanged) {
    historyList.scrollTop = 0;
  }

  if (!history.length) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = "No moves yet.";
    historyList.appendChild(empty);
    return;
  }

  const latestTurnIndex = Math.floor((history.length - 1) / 2) * 2;
  for (let index = latestTurnIndex; index >= 0; index -= 2) {
    const row = document.createElement("div");
    row.className = "history-row";

    const turn = document.createElement("span");
    turn.className = "history-turn";
    turn.textContent = `${index / 2 + 1}.`;

    const whiteMove = document.createElement("span");
    whiteMove.className = "history-move";
    whiteMove.textContent = history[index] ? internalMoveToText(history[index]) : "";

    const blackMove = document.createElement("span");
    blackMove.className = "history-move";
    blackMove.textContent = history[index + 1] ? internalMoveToText(history[index + 1]) : "";

    row.append(turn, whiteMove, blackMove);
    historyList.appendChild(row);
  }

}

function updateStatus() {
  if (!state.mode) {
    statusText.textContent = "Choose a mode to begin";
    return;
  }

  if (state.aiThinking) {
    statusText.textContent = "AI is thinking...";
    return;
  }

  if (isGameOver()) {
    statusText.textContent = `${state.winner === "w" ? "White" : "Black"} wins.`;
    return;
  }

  if (state.selected) {
    statusText.textContent = `Selected ${state.selected.toUpperCase()}. Choose a legal move.`;
    return;
  }

  statusText.textContent = `${getTurnLabel()} to move.`;
}

function renderBoard() {
  boardEl.classList.toggle("is-pvp-opponent-view", shouldRotateBlackPieces());
  const selected = state.selected;
  const legalTargets = new Map(state.legalMoves.map((move) => [move.square, move.capture]));

  Array.from(boardEl.children).forEach((squareEl) => {
    const square = squareEl.dataset.square;
    const piece = game.get(square);
    squareEl.classList.remove("selected", "move", "capture", "white-piece", "black-piece");
    squareEl.innerHTML = "";

    if (selected === square) {
      squareEl.classList.add("selected");
    }

    if (legalTargets.has(square)) {
      squareEl.classList.add(legalTargets.get(square) ? "capture" : "move");
    }

    if (piece) {
      squareEl.classList.add(piece.color === "w" ? "white-piece" : "black-piece");
      const pieceEl = document.createElement("img");
      pieceEl.className = `piece piece--${piece.color === "w" ? "white" : "black"}`;
      pieceEl.src = PIECE_IMAGES[piece.type][piece.color];
      pieceEl.alt = `${piece.color === "w" ? "White" : "Black"} ${piece.type}`;
      squareEl.appendChild(pieceEl);
    }
  });
}

function getMoveAnimationSnapshot(fromSquare, toSquare, matchedMove) {
  const sourcePiece = boardEl.querySelector(`[data-square="${fromSquare}"] .piece`);
  let capturedSquare = toSquare;

  // En passant captures a pawn beside the destination rather than on it.
  if (matchedMove.captured && !game.get(toSquare)) {
    capturedSquare = `${toSquare[0]}${fromSquare[1]}`;
  }

  const capturedPiece = matchedMove.captured
    ? boardEl.querySelector(`[data-square="${capturedSquare}"] .piece`)
    : null;

  return {
    fromSquare,
    toSquare,
    sourcePiece: sourcePiece?.cloneNode(true) || null,
    sourceRect: sourcePiece?.getBoundingClientRect() || null,
    capturedPiece: capturedPiece?.cloneNode(true) || null,
    capturedRect: capturedPiece?.getBoundingClientRect() || null,
  };
}

function placeAnimationPiece(piece, rect, className) {
  const layer = document.createElement("div");
  layer.className = `${className}${shouldRotateBlackPieces() ? " is-pvp-opponent-view" : ""}`;
  layer.style.left = `${rect.left}px`;
  layer.style.top = `${rect.top}px`;
  layer.style.width = `${rect.width}px`;
  layer.style.height = `${rect.height}px`;
  layer.appendChild(piece);
  document.body.appendChild(layer);
  return layer;
}

async function animateCommittedMove(move) {
  const snapshot = moveAnimationSnapshots.get(move);
  moveAnimationSnapshots.delete(move);
  const shouldAnimate = Boolean(
    snapshot?.sourcePiece
    && snapshot.sourceRect
    && !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  state.animating = shouldAnimate;
  render();

  if (!shouldAnimate) {
    return;
  }

  const destinationPiece = boardEl.querySelector(`[data-square="${snapshot.toSquare}"] .piece`);
  const destinationRect = destinationPiece?.getBoundingClientRect();
  if (!destinationPiece || !destinationRect) {
    state.animating = false;
    render();
    return;
  }

  destinationPiece.classList.add("piece--animation-target");
  const movingLayer = placeAnimationPiece(snapshot.sourcePiece, snapshot.sourceRect, "piece-animation-layer");
  const capturedLayer = snapshot.capturedPiece && snapshot.capturedRect
    ? placeAnimationPiece(snapshot.capturedPiece, snapshot.capturedRect, "piece-animation-layer piece-animation-layer--captured")
    : null;
  const deltaX = destinationRect.left - snapshot.sourceRect.left;
  const deltaY = destinationRect.top - snapshot.sourceRect.top;
  const movement = movingLayer.animate(
    [{ transform: "translate3d(0, 0, 0)" }, { transform: `translate3d(${deltaX}px, ${deltaY}px, 0)` }],
    { duration: MOVE_ANIMATION_MS, easing: "linear", fill: "forwards" },
  );
  const captureTimer = window.setTimeout(() => capturedLayer?.remove(), MOVE_ANIMATION_MS / 2);

  try {
    await movement.finished;
  } catch {
    // A reset or navigation can cancel an in-flight animation.
  } finally {
    window.clearTimeout(captureTimer);
    capturedLayer?.remove();
    movingLayer.remove();
    destinationPiece.classList.remove("piece--animation-target");
    state.animating = false;
    render();
  }
}

function updateWinnerState() {
  if (!hasKing("w")) {
    state.winner = "b";
    return;
  }

  if (!hasKing("b")) {
    state.winner = "w";
    return;
  }

  const moves = game._moves({ legal: false });
  if (!moves.length) {
    state.winner = game.turn() === "w" ? "b" : "w";
    return;
  }

  state.winner = null;
}

function executePseudoMove(from, to, promotion) {
  const fromSquare = typeof from === "string" ? from : internalSquareToAlgebraic(from);
  const toSquare = typeof to === "string" ? to : internalSquareToAlgebraic(to);
  const candidateMoves = game._moves({ legal: false, square: fromSquare });
  const piece = game.get(fromSquare);
  const matchedMove = candidateMoves.find((move) => {
    const moveTo = internalSquareToAlgebraic(move.to);
    if (moveTo !== toSquare) {
      return false;
    }

    if (promotion && move.promotion && move.promotion !== promotion) {
      return false;
    }

    if (promotion && !move.promotion) {
      return false;
    }

    return true;
  });

  if (!matchedMove) {
    return null;
  }

  if (promotion && piece && piece.type === "p") {
    matchedMove.promotion = promotion;
  }

  moveAnimationSnapshots.set(matchedMove, getMoveAnimationSnapshot(fromSquare, toSquare, matchedMove));
  game._makeMove(matchedMove);
  playMoveSound(Boolean(matchedMove.captured));
  updateWinnerState();
  return matchedMove;
}

function render() {
  renderBoard();
  renderHistory();
  updateStatus();
  undoBtn.disabled = !canUndo();
  resetBtn.disabled = state.animating;
  backBtn.disabled = state.animating;
}

function showGame(mode) {
  state.mode = mode;
  state.humanColor = "w";
  clearPromotion();
  clearWinner();
  clearSelection();
  landingEl.classList.add("is-hidden");
  gameViewEl.classList.remove("is-hidden");
  document.body.classList.add("game-active");
  siteFooter.classList.add("is-hidden");
  game.reset();
  render();
  maybeRunAiMove();
}

function showAiGame(humanColor) {
  colorModal.classList.add("is-hidden");
  state.mode = "ai";
  state.humanColor = humanColor;
  clearPromotion();
  clearWinner();
  clearSelection();
  landingEl.classList.add("is-hidden");
  gameViewEl.classList.remove("is-hidden");
  document.body.classList.add("game-active");
  siteFooter.classList.add("is-hidden");
  game.reset();
  render();
  maybeRunAiMove();
}

function showLanding() {
  state.mode = null;
  state.humanColor = "w";
  cancelAiMove();
  clearPromotion();
  colorModal.classList.add("is-hidden");
  clearWinner();
  clearSelection();
  game.reset();
  gameViewEl.classList.add("is-hidden");
  document.body.classList.remove("game-active");
  landingEl.classList.remove("is-hidden");
  siteFooter.classList.remove("is-hidden");
  render();
}

async function attemptMove(from, to) {
  if (isPromotionMove(from, to)) {
    showPromotionPicker(from, to);
    return true;
  }

  const move = executePseudoMove(from, to);
  if (!move) {
    return false;
  }

  clearSelection();
  await animateCommittedMove(move);
  maybeRunAiMove();
  return true;
}

function onSquareClick(square) {
  if (!state.mode || state.aiThinking || state.animating || isGameOver()) {
    return;
  }

  const piece = game.get(square);

  if (state.selected === square) {
    clearSelection();
    render();
    return;
  }

  if (state.selected && state.legalMoves.some((move) => move.square === square)) {
    attemptMove(state.selected, square);
    return;
  }

  if (piece && piece.color === game.turn() && (state.mode === "human" || piece.color === state.humanColor)) {
    state.selected = square;
    state.legalMoves = legalMovesFrom(square);
    render();
  }
}

function undoMove() {
  if (!canUndo()) return;

  clearPromotion();
  clearWinner();
  for (let step = 0; step < getUndoCount(); step++) {
    game.undo();
  }
  clearSelection();
  render();
}

function restartGame() {
  clearPromotion();
  clearWinner();
  game.reset();
  cancelAiMove();
  clearSelection();
  render();
  maybeRunAiMove();
}

function evaluateBoard(searchGame = game) {
  const pieceValues = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };
  const pieceSquareTables = {
    p: [
      0, 0, 0, 0, 0, 0, 0, 0,
      50, 50, 50, 50, 50, 50, 50, 50,
      10, 10, 20, 30, 30, 20, 10, 10,
      5, 5, 10, 25, 25, 10, 5, 5,
      0, 0, 0, 20, 20, 0, 0, 0,
      5, -5, -10, 0, 0, -10, -5, 5,
      5, 10, 10, -20, -20, 10, 10, 5,
      0, 0, 0, 0, 0, 0, 0, 0,
    ],
    n: [
      -50, -40, -30, -30, -30, -30, -40, -50,
      -40, -20, 0, 0, 0, 0, -20, -40,
      -30, 0, 10, 15, 15, 10, 0, -30,
      -30, 5, 15, 20, 20, 15, 5, -30,
      -30, 0, 15, 20, 20, 15, 0, -30,
      -30, 5, 10, 15, 15, 10, 5, -30,
      -40, -20, 0, 5, 5, 0, -20, -40,
      -50, -40, -30, -30, -30, -30, -40, -50,
    ],
    b: [
      -20, -10, -10, -10, -10, -10, -10, -20,
      -10, 0, 0, 0, 0, 0, 0, -10,
      -10, 0, 5, 10, 10, 5, 0, -10,
      -10, 5, 5, 10, 10, 5, 5, -10,
      -10, 0, 10, 10, 10, 10, 0, -10,
      -10, 10, 10, 10, 10, 10, 10, -10,
      -10, 5, 0, 0, 0, 0, 5, -10,
      -20, -10, -10, -10, -10, -10, -10, -20,
    ],
    r: [
      0, 0, 0, 5, 5, 0, 0, 0,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      5, 10, 10, 10, 10, 10, 10, 5,
      0, 0, 0, 0, 0, 0, 0, 0,
    ],
    q: [
      -20, -10, -10, -5, -5, -10, -10, -20,
      -10, 0, 0, 0, 0, 0, 0, -10,
      -10, 0, 5, 5, 5, 5, 0, -10,
      -5, 0, 5, 5, 5, 5, 0, -5,
      0, 0, 5, 5, 5, 5, 0, -5,
      -10, 5, 5, 5, 5, 5, 0, -10,
      -10, 0, 5, 0, 0, 0, 0, -10,
      -20, -10, -10, -5, -5, -10, -10, -20,
    ],
    k: [
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -20, -30, -30, -40, -40, -30, -30, -20,
      -10, -20, -20, -20, -20, -20, -20, -10,
      20, 20, 0, 0, 0, 0, 20, 20,
      20, 30, 10, 0, 0, 10, 30, 20,
    ],
  };

  let score = 0;
  for (let index = 0; index < searchGame.board().length; index += 1) {
    const row = searchGame.board()[index];
    for (let file = 0; file < row.length; file += 1) {
      const piece = row[file];
      if (!piece) {
        continue;
      }

      const boardIndex = index * 8 + file;
      const tableIndex = 63 - boardIndex;
      const table = pieceSquareTables[piece.type];
      const tableBonus = table ? table[tableIndex] : 0;
      const pieceScore = pieceValues[piece.type] + tableBonus;
      score += piece.color === "b" ? pieceScore : -pieceScore;
    }
  }

  return score;
}

async function pickBestMove() {
  const aiColor = getAiColor();
  const searchGame = new Chess(game.fen());
  const deadline = performance.now() + AI_SEARCH_TIME_MS;
  const fallbackMoves = getOrderedMoves(searchGame);
  if (!fallbackMoves.length) {
    return null;
  }

  let completedResult = moveToResult(fallbackMoves[0]);

  // Iterative deepening always leaves us with a move from the last fully
  // completed depth. An interrupted depth is discarded rather than allowing
  // a partially searched root move to bias the result.
  for (let depth = 1; depth <= AI_SEARCH_MAX_DEPTH; depth += 1) {
    try {
      const candidates = await searchBestMoves(searchGame, depth, aiColor, deadline, { nodes: 0 });
      if (candidates.length) {
        completedResult = chooseHumanLikeMove(candidates);
      }
    } catch (error) {
      if (error !== AI_SEARCH_TIMEOUT) {
        throw error;
      }
      break;
    }
  }

  return completedResult;
}

function moveSortScore(move) {
  const captureWeight = move.captured ? (move.captured === "k" ? 10000 : 1000) + (move.captured ? 100 : 0) : 0;
  const promotionWeight = move.promotion ? 500 : 0;
  return captureWeight + promotionWeight;
}

function getOrderedMoves(searchGame = game) {
  return searchGame._moves({ legal: false }).slice().sort((a, b) => moveSortScore(b) - moveSortScore(a));
}

function moveToResult(move) {
  const from = internalSquareToAlgebraic(move.from);
  const to = internalSquareToAlgebraic(move.to);
  return {
    from,
    to,
    promotion: move.promotion || (isPromotionMove(from, to) ? "q" : undefined),
  };
}

function checkSearchDeadline(deadline) {
  if (performance.now() >= deadline) {
    throw AI_SEARCH_TIMEOUT;
  }
}

async function yieldToBrowser(searchContext, deadline) {
  searchContext.nodes += 1;
  checkSearchDeadline(deadline);
  if (searchContext.nodes % AI_SEARCH_YIELD_EVERY_NODES === 0) {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    checkSearchDeadline(deadline);
  }
}

function chooseHumanLikeMove(candidates) {
  const bestScore = candidates[0].score;
  const nearBest = candidates
    .filter((candidate) => bestScore - candidate.score <= AI_NEAR_BEST_MARGIN)
    .slice(0, 3);

  // Usually play the best move, while occasionally choosing another move
  // whose evaluation is close. This avoids unrealistically perfect play at
  // shallow depth and targets roughly club-beginner strength (~1000 Elo).
  let selectedIndex = 0;
  const roll = Math.random();
  if (nearBest.length >= 3 && roll > 0.92) {
    selectedIndex = 2;
  } else if (nearBest.length >= 2 && roll > 0.78) {
    selectedIndex = 1;
  }

  return moveToResult(nearBest[selectedIndex].move);
}

async function searchBestMoves(searchGame, depth, aiColor, deadline, searchContext) {
  await yieldToBrowser(searchContext, deadline);
  const moves = getOrderedMoves(searchGame);
  const candidates = [];

  if (!moves.length) {
    return candidates;
  }

  for (const move of moves) {
    await yieldToBrowser(searchContext, deadline);
    searchGame._makeMove(move);
    try {
      const score = await search(searchGame, depth - 1, -Infinity, Infinity, aiColor, deadline, searchContext);
      candidates.push({ move, score });
    } finally {
      searchGame._undoMove();
    }
  }

  return candidates.sort((a, b) => b.score - a.score);
}

async function search(searchGame, depth, alpha, beta, aiColor, deadline, searchContext) {
  await yieldToBrowser(searchContext, deadline);

  if (searchGame._kings.w === -1) {
    return aiColor === "b" ? 100000 : -100000;
  }

  if (searchGame._kings.b === -1) {
    return aiColor === "w" ? 100000 : -100000;
  }

  if (depth <= 0) {
    const base = evaluateBoard(searchGame);
    return aiColor === "b" ? base : -base;
  }

  const moves = searchGame._moves({ legal: false });
  if (!moves.length) {
    return searchGame.turn() === aiColor ? -100000 : 100000;
  }

  const maximizing = searchGame.turn() === aiColor;
  let best = maximizing ? -Infinity : Infinity;
  const orderedMoves = moves.slice().sort((a, b) => moveSortScore(b) - moveSortScore(a));

  for (const move of orderedMoves) {
    await yieldToBrowser(searchContext, deadline);
    searchGame._makeMove(move);
    let score;
    try {
      score = await search(searchGame, depth - 1, alpha, beta, aiColor, deadline, searchContext);
    } finally {
      searchGame._undoMove();
    }

    if (maximizing) {
      if (score > best) {
        best = score;
      }
      if (score > alpha) {
        alpha = score;
      }
      if (beta <= alpha) {
        break;
      }
    } else {
      if (score < best) {
        best = score;
      }
      if (score < beta) {
        beta = score;
      }
      if (beta <= alpha) {
        break;
      }
    }
  }

  return best;
}

function cancelAiMove() {
  state.aiJobId += 1;
  state.aiThinking = false;
}

async function playFirstAvailableAiMove(preferredMove) {
  const candidates = preferredMove
    ? [preferredMove, ...getOrderedMoves().map(moveToResult)]
    : getOrderedMoves().map(moveToResult);

  for (const move of candidates) {
    const promotion = move.promotion || (isPromotionMove(move.from, move.to) ? "q" : undefined);
    const committedMove = executePseudoMove(move.from, move.to, promotion);
    if (committedMove) {
      await animateCommittedMove(committedMove);
      return true;
    }
  }

  return false;
}

function maybeRunAiMove() {
  const aiColor = getAiColor();
  if (state.mode !== "ai" || state.aiThinking || isGameOver() || game.turn() !== aiColor) {
    return;
  }

  state.aiThinking = true;
  const jobId = ++state.aiJobId;
  render();

  let finished = false;
  const finish = async (preferredMove = null) => {
    if (finished || jobId !== state.aiJobId) {
      return;
    }

    finished = true;
    if (!isGameOver() && game.turn() === aiColor) {
      await playFirstAvailableAiMove(preferredMove);
    }
    state.aiThinking = false;
    render();
  };

  // The search yields to the browser, so this watchdog can always run. If
  // evaluation fails or stalls, play the first available move at five seconds.
  const watchdogId = window.setTimeout(() => finish(), AI_MOVE_HARD_TIMEOUT_MS);

  window.setTimeout(async () => {
    try {
      finish(await pickBestMove());
    } catch (error) {
      console.error("AI move failed; using a fallback move.", error);
      finish();
    } finally {
      window.clearTimeout(watchdogId);
    }
  }, AI_MOVE_DELAY_MS);
}

buildAxes();
buildBoard();
copyrightYear.textContent = String(new Date().getFullYear());
loadAboutContent();
render();

startHumanBtn.addEventListener("click", () => showGame("human"));
startAiBtn.addEventListener("click", showColorPicker);
startAiWhiteBtn.addEventListener("click", () => showAiGame("w"));
startAiBlackBtn.addEventListener("click", () => showAiGame("b"));
backBtn.addEventListener("click", showLanding);
undoBtn.addEventListener("click", undoMove);
resetBtn.addEventListener("click", restartGame);
promotionModal.addEventListener("click", (event) => {
  if (event.target === promotionModal || event.target.classList.contains("promotion-modal__backdrop")) {
    clearPromotion();
  }
});
colorModal.addEventListener("click", (event) => {
  if (event.target.classList.contains("choice-modal__backdrop")) clearColorPicker();
});
document.addEventListener("pointerdown", unlockAudio, { once: true });
