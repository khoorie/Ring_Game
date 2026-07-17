async function main() {
  if (Builder.isServer) {
    // Nothing to do server-side; the game markup ships in the custom code block.
  }

  if (Builder.isBrowser) {

    function clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }

    function initRingToss(root) {
      if (!root || root.dataset.ertReady === "true") return;
      root.dataset.ertReady = "true";

      var stage = root.querySelector("[data-ert-stage]");
      var launchRing = root.querySelector("[data-ert-launch]");
      var airRing = root.querySelector("[data-ert-air-ring]");
      var aimLine = root.querySelector("[data-ert-aim]");
      var feedback = root.querySelector("[data-ert-feedback]");
      var instruction = root.querySelector("[data-ert-instruction]");
      var intro = root.querySelector("[data-ert-intro]");
      var results = root.querySelector("[data-ert-results]");
      var startButton = root.querySelector("[data-ert-start]");
      var playAgainButton = root.querySelector("[data-ert-play-again]");
      var resetButton = root.querySelector("[data-ert-reset]");
      var scoreEl = root.querySelector("[data-ert-score]");
      var ringsEl = root.querySelector("[data-ert-rings]");
      var streakEl = root.querySelector("[data-ert-streak]");
      var bestEl = root.querySelector("[data-ert-best]");
      var finalScoreEl = root.querySelector("[data-ert-final-score]");
      var bestCopyEl = root.querySelector("[data-ert-best-copy]");
      var targets = Array.prototype.slice.call(root.querySelectorAll(".ert-target"));

      if (!stage || !launchRing || !airRing || !aimLine) return;

      var totalRings = parseInt(root.getAttribute("data-rings"), 10) || 10;
      var score = 0;
      var ringsLeft = totalRings;
      var streak = 0;
      var isDragging = false;
      var isFlying = false;
      var gameStarted = false;
      var startPoint = null;
      var pointerId = null;
      var swipeSamples = [];
      var bestStorageKey = "engagementRingTossBest";
      var best = 0;
      var audioContext = null;

      try {
        best = parseInt(window.localStorage.getItem(bestStorageKey), 10) || 0;
      } catch (error) {
        best = 0;
      }

      function updateHud() {
        scoreEl.textContent = String(score);
        ringsEl.textContent = String(ringsLeft);
        streakEl.textContent = String(streak);
        bestEl.textContent = String(best);
      }

      function setInstruction(message) {
        instruction.textContent = message;
      }

      function playTone(hit) {
        try {
          audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
          var oscillator = audioContext.createOscillator();
          var gain = audioContext.createGain();
          oscillator.type = hit ? "sine" : "triangle";
          oscillator.frequency.setValueAtTime(hit ? 620 : 170, audioContext.currentTime);
          if (hit) {
            oscillator.frequency.exponentialRampToValueAtTime(920, audioContext.currentTime + 0.12);
          }
          gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.12, audioContext.currentTime + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.18);
          oscillator.connect(gain);
          gain.connect(audioContext.destination);
          oscillator.start();
          oscillator.stop(audioContext.currentTime + 0.2);
        } catch (error) {
          // Sound is optional.
        }
      }

      function showFeedback(message) {
        feedback.textContent = message;
        feedback.classList.remove("is-showing");
        void feedback.offsetWidth;
        feedback.classList.add("is-showing");
      }

      function getLaunchCenter() {
        var stageRect = stage.getBoundingClientRect();
        var ringRect = launchRing.getBoundingClientRect();
        return {
          x: ringRect.left + ringRect.width / 2 - stageRect.left,
          y: ringRect.top + ringRect.height / 2 - stageRect.top
        };
      }

      function resetLaunchRing() {
        launchRing.style.transform = "";
        launchRing.disabled = false;
        aimLine.classList.remove("is-visible");
        airRing.classList.remove("is-flying");
        airRing.style.opacity = "";
        airRing.style.transform = "";
        isDragging = false;
        isFlying = false;
        pointerId = null;
        swipeSamples = [];
      }

      function resetGame(showIntro) {
        score = 0;
        ringsLeft = totalRings;
        streak = 0;
        gameStarted = !showIntro;
        targets.forEach(function (target) {
          target.classList.remove("is-hit");
          target.removeAttribute("data-hit");
          var landedRing = target.querySelector(".ert-landed-ring");
          if (landedRing) landedRing.remove();
        });
        results.classList.remove("is-visible");
        intro.classList.toggle("is-visible", !!showIntro);
        setInstruction("Flick the ring in any direction");
        resetLaunchRing();
        updateHud();
      }

      function startGame() {
        gameStarted = true;
        intro.classList.remove("is-visible");
        results.classList.remove("is-visible");
        setInstruction("Flick the ring in any direction");
        updateHud();
        launchRing.focus({ preventScroll: true });
      }

      function finishGame() {
        gameStarted = false;
        if (score > best) {
          best = score;
          try {
            window.localStorage.setItem(bestStorageKey, String(best));
          } catch (error) {
            // Local storage is optional.
          }
        }
        updateHud();
        finalScoreEl.textContent = String(score);
        bestCopyEl.textContent = score === best && score > 0
          ? "New best score!"
          : "Your best: " + best;
        results.classList.add("is-visible");

        root.dispatchEvent(new CustomEvent("ring-toss-complete", {
          bubbles: true,
          detail: {
            score: score,
            best: best,
            ringsUsed: totalRings
          }
        }));
      }

      function findTarget(x, y) {
        var stageRect = stage.getBoundingClientRect();
        var nearest = null;
        var nearestDistance = Infinity;

        targets.forEach(function (target) {
          if (target.getAttribute("data-hit") === "true") return;

          var finger = target.querySelector(".ert-finger");
          var rect = finger.getBoundingClientRect();
          var targetX = rect.left + rect.width / 2 - stageRect.left;
          var targetY = rect.top + rect.height * 0.63 - stageRect.top;
          var distance = Math.hypot(x - targetX, y - targetY);
          var hitRadius = Math.max(25, rect.width * 0.9);

          if (distance <= hitRadius && distance < nearestDistance) {
            nearest = target;
            nearestDistance = distance;
          }
        });

        return nearest;
      }

      function landOnTarget(target) {
        var basePoints = parseInt(target.getAttribute("data-points"), 10) || 10;
        streak += 1;
        var streakBonus = Math.max(0, streak - 1) * 5;
        var earned = basePoints + streakBonus;

        score += earned;
        target.setAttribute("data-hit", "true");
        target.classList.add("is-hit");

        var landedRing = document.createElement("span");
        landedRing.className = "ert-landed-ring";
        landedRing.setAttribute("aria-hidden", "true");
        landedRing.innerHTML =
          '<span class="ert-landed-front-arc" aria-hidden="true"></span>' +
          '<span class="ert-landed-diamond" aria-hidden="true"></span>';
        target.appendChild(landedRing);

        showFeedback("She Said Yes!");
        setInstruction("+" + earned + (streak > 1 ? " — " + streak + " in a row!" : " points!"));
        playTone(true);
        if (navigator.vibrate) navigator.vibrate(28);
      }

      function missTarget() {
        streak = 0;
        showFeedback("She Said No…");
        setInstruction("Flick toward the middle of a finger");
        playTone(false);
      }

      function completeToss(endX, endY) {
        var target = findTarget(endX, endY);
        if (target) {
          landOnTarget(target);
        } else {
          missTarget();
        }

        ringsLeft -= 1;
        updateHud();

        window.setTimeout(function () {
          resetLaunchRing();
          if (ringsLeft <= 0 || targets.every(function (targetItem) {
            return targetItem.getAttribute("data-hit") === "true";
          })) {
            finishGame();
          }
        }, 480);
      }

      function animateToss(from, to, duration) {
        isFlying = true;
        launchRing.disabled = true;
        launchRing.style.transform = "";
        aimLine.classList.remove("is-visible");
        airRing.classList.add("is-flying");

        var startTime = performance.now();
        var control = {
          x: (from.x + to.x) / 2,
          y: Math.min(from.y, to.y) - stage.clientHeight * 0.23
        };

        function frame(now) {
          var t = clamp((now - startTime) / duration, 0, 1);
          var eased = 1 - Math.pow(1 - t, 2);
          var inverse = 1 - eased;
          var x = inverse * inverse * from.x + 2 * inverse * eased * control.x + eased * eased * to.x;
          var y = inverse * inverse * from.y + 2 * inverse * eased * control.y + eased * eased * to.y;
          var depthScale = 1 - ((from.y - y) / stage.clientHeight) * 0.52;
          var scale = clamp(depthScale, 0.5, 1.08);
          var rotation = eased * 420;

          airRing.style.transform =
            "translate3d(" + x + "px," + y + "px,0) " +
            "scale(" + scale + ") rotate(" + rotation + "deg)";
          airRing.style.opacity = String(clamp(1 - Math.max(0, eased - 0.9) * 4, 0.15, 1));

          if (t < 1) {
            requestAnimationFrame(frame);
          } else {
            completeToss(to.x, to.y);
          }
        }

        requestAnimationFrame(frame);
      }

      function onPointerDown(event) {
        if (!gameStarted || isFlying || ringsLeft <= 0) return;

        var stageRect = stage.getBoundingClientRect();
        isDragging = true;
        pointerId = event.pointerId;
        startPoint = getLaunchCenter();
        swipeSamples = [{
          x: event.clientX - stageRect.left,
          y: event.clientY - stageRect.top,
          t: event.timeStamp
        }];
        try {
          stage.setPointerCapture(pointerId);
        } catch (error) {
          // Pointer capture is optional.
        }
        setInstruction("Flick toward a finger");
        event.preventDefault();
      }

      function onPointerMove(event) {
        if (!isDragging || event.pointerId !== pointerId) return;

        var stageRect = stage.getBoundingClientRect();
        var current = {
          x: event.clientX - stageRect.left,
          y: event.clientY - stageRect.top,
          t: event.timeStamp
        };
        swipeSamples.push(current);
        while (swipeSamples.length > 2 && current.t - swipeSamples[0].t > 160) {
          swipeSamples.shift();
        }

        var first = swipeSamples[0];
        var dx = current.x - first.x;
        var dy = current.y - first.y;
        var distance = Math.hypot(dx, dy);
        var angle = Math.atan2(dy, dx) * 180 / Math.PI;

        launchRing.style.transform =
          "translate3d(" + clamp(dx * 0.22, -42, 42) + "px," +
          clamp(dy * 0.16, -36, 36) + "px,0) rotate(" +
          clamp(dx * 0.12, -14, 14) + "deg)";

        aimLine.style.left = startPoint.x + "px";
        aimLine.style.top = startPoint.y + "px";
        aimLine.style.width = Math.min(distance * 1.6, stage.clientHeight * 0.38) + "px";
        aimLine.style.transform = "rotate(" + angle + "deg)";
        aimLine.classList.toggle("is-visible", distance > 14);
        event.preventDefault();
      }

      function onPointerUp(event) {
        if (!isDragging || event.pointerId !== pointerId) return;

        isDragging = false;
        try {
          stage.releasePointerCapture(pointerId);
        } catch (error) {
          // Pointer may already be released.
        }

        var stageRect = stage.getBoundingClientRect();
        var release = {
          x: event.clientX - stageRect.left,
          y: event.clientY - stageRect.top,
          t: event.timeStamp
        };
        var first = swipeSamples[0] || release;
        var dx = release.x - first.x;
        var dy = release.y - first.y;
        var swipeDistance = Math.hypot(dx, dy);
        var elapsed = Math.max(release.t - first.t, 16);
        var speed = swipeDistance / elapsed;

        if (swipeDistance < 24 || speed < 0.25) {
          setInstruction("Flick faster to toss the ring");
          resetLaunchRing();
          return;
        }

        var throwDistance = clamp(speed * 340, stage.clientHeight * 0.3, stage.clientHeight * 1.05);
        var endX = clamp(startPoint.x + (dx / swipeDistance) * throwDistance, 26, stage.clientWidth - 26);
        var endY = clamp(startPoint.y + (dy / swipeDistance) * throwDistance, stage.clientHeight * 0.1, stage.clientHeight * 0.92);
        var duration = clamp(430 + throwDistance * 0.55, 560, 820);

        animateToss(startPoint, { x: endX, y: endY }, duration);
        event.preventDefault();
      }

      function onPointerCancel() {
        if (isDragging) resetLaunchRing();
      }

      startButton.addEventListener("click", startGame);
      playAgainButton.addEventListener("click", function () {
        resetGame(false);
        startGame();
      });
      resetButton.addEventListener("click", function () {
        resetGame(false);
        startGame();
      });

      stage.addEventListener("pointerdown", onPointerDown);
      stage.addEventListener("pointermove", onPointerMove);
      stage.addEventListener("pointerup", onPointerUp);
      stage.addEventListener("pointercancel", onPointerCancel);

      updateHud();
    }

    function initAllRingTossGames() {
      document.querySelectorAll("[data-ring-toss-game]").forEach(initRingToss);
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initAllRingTossGames);
    } else {
      initAllRingTossGames();
    }

    if (!window.__ertMutationObserver) {
      window.__ertMutationObserver = new MutationObserver(initAllRingTossGames);
      window.__ertMutationObserver.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
    }
  }
}

export default main();
