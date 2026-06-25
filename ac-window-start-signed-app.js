"use strict";

const MINUTES_PER_DAY = 1440;
const INITIAL_DEFAULTS = {
  tocHours: 8,
  tocMinutes: 55,
  todHours: 12,
  todMinutes: 15,
  tocModifier: 5,
  todModifier: -15,
  startHours: 12,
  startMinutes: 55,
  crewCount: 3,
  breaksPerPilot: 1,
  manualOverride: "",
  alarmOffset: -15
};
const RESET_DEFAULTS = {
  ...INITIAL_DEFAULTS,
  tocHours: 0,
  tocMinutes: 0,
  todHours: 0,
  todMinutes: 0,
  tocModifier: 5,
  todModifier: -15,
  startHours: 0,
  startMinutes: 0
};

const els = {
  form: document.querySelector("#calculatorForm"),
  tocHours: document.querySelector("#tocHours"),
  tocMinutes: document.querySelector("#tocMinutes"),
  todHours: document.querySelector("#todHours"),
  todMinutes: document.querySelector("#todMinutes"),
  tocModifier: document.querySelector("#tocModifier"),
  todModifier: document.querySelector("#todModifier"),
  startHours: document.querySelector("#startHours"),
  startMinutes: document.querySelector("#startMinutes"),
  manualOverride: document.querySelector("#manualOverride"),
  alarmOffset: document.querySelector("#alarmOffset"),
  currentUtc: document.querySelector("#currentUtc"),
  deviceClock: document.querySelector("#deviceClock"),
  deviceOffset: document.querySelector("#deviceOffset"),
  deviceMessage: document.querySelector("#deviceMessage"),
  usableRest: document.querySelector("#usableRest"),
  totalPerPilot: document.querySelector("#totalPerPilot"),
  periodUsed: document.querySelector("#periodUsed"),
  slotCount: document.querySelector("#slotCount"),
  scheduleContext: document.querySelector("#scheduleContext"),
  scheduleBody: document.querySelector("#scheduleBody"),
  shareStatus: document.querySelector("#shareStatus"),
  installStatus: document.querySelector("#installStatus"),
  copyButton: document.querySelector("#copyButton"),
  downloadButton: document.querySelector("#downloadButton"),
  shareButton: document.querySelector("#shareButton"),
  resetButton: document.querySelector("#resetButton")
};

let latestResult = null;

init();

function init() {
  populateTimePickers();
  hydrateDefaults(INITIAL_DEFAULTS);
  bindEvents();
  registerServiceWorker();
  render();
  setInterval(updateDeviceClock, 15000);
}

function populateTimePickers() {
  for (const pair of [
    [els.tocHours, els.tocMinutes],
    [els.todHours, els.todMinutes],
    [els.startHours, els.startMinutes]
  ]) {
    populateClockPicker(pair[0], pair[1]);
  }
}

function populateClockPicker(hoursSelect, minutesSelect) {
  hoursSelect.innerHTML = range(0, 23)
    .map((hour) => `<option value="${hour}">${String(hour).padStart(2, "0")}</option>`)
    .join("");
  minutesSelect.innerHTML = range(0, 59)
    .map((minute) => `<option value="${minute}">${String(minute).padStart(2, "0")}</option>`)
    .join("");
}

function hydrateDefaults(defaults) {
  els.tocHours.value = String(defaults.tocHours);
  els.tocMinutes.value = String(defaults.tocMinutes);
  els.todHours.value = String(defaults.todHours);
  els.todMinutes.value = String(defaults.todMinutes);
  els.tocModifier.value = String(defaults.tocModifier);
  els.todModifier.value = String(defaults.todModifier);
  els.startHours.value = String(defaults.startHours);
  els.startMinutes.value = String(defaults.startMinutes);
  els.manualOverride.value = defaults.manualOverride;
  els.alarmOffset.value = String(defaults.alarmOffset);
  setRadioValue("crewCount", defaults.crewCount);
  setRadioValue("breaksPerPilot", defaults.breaksPerPilot);
}

function bindEvents() {
  els.form.addEventListener("input", render);
  els.form.addEventListener("change", render);
  els.copyButton.addEventListener("click", copySchedule);
  els.downloadButton.addEventListener("click", downloadPdf);
  els.shareButton.addEventListener("click", sharePdf);
  els.resetButton.addEventListener("click", () => {
    hydrateDefaults(RESET_DEFAULTS);
    render();
  });
}

function readInputs() {
  const tocHours = Number(els.tocHours.value);
  const tocMinutesPart = Number(els.tocMinutes.value);
  const todHours = Number(els.todHours.value);
  const todMinutesPart = Number(els.todMinutes.value);
  const startHours = Number(els.startHours.value);
  const startMinutesPart = Number(els.startMinutes.value);
  return {
    flightDate: todayUtcIsoDate(),
    estimatedTocMinutes: tocHours * 60 + tocMinutesPart,
    estimatedTodMinutes: todHours * 60 + todMinutesPart,
    tocModifierMinutes: Number(els.tocModifier.value || 0),
    todModifierMinutes: Number(els.todModifier.value || 0),
    startMinutes: startHours * 60 + startMinutesPart,
    crewCount: Number(getRadioValue("crewCount")),
    breaksPerPilot: Number(getRadioValue("breaksPerPilot")),
    manualOverrideMinutes: parseOptionalDuration(els.manualOverride.value),
    alarmOffsetMinutes: Number(els.alarmOffset.value || 0),
    deviceTimeZone: getDeviceTimeZone()
  };
}

function calculateRest(inputs) {
  const adjustedTocMinutes = inputs.estimatedTocMinutes + inputs.tocModifierMinutes;
  const adjustedTodMinutes = inputs.estimatedTodMinutes + inputs.todModifierMinutes;
  const usableRestMinutes = calculateWindowMinutes(adjustedTocMinutes, adjustedTodMinutes);
  const totalRestPerPilot =
    inputs.crewCount === 4
      ? Math.floor(usableRestMinutes / 2)
      : inputs.crewCount === 3
        ? Math.floor(usableRestMinutes / 3)
        : 0;
  const calculatedPeriod = Math.floor(totalRestPerPilot / inputs.breaksPerPilot);
  const slotCount =
    inputs.crewCount === 4 ? 2 * inputs.breaksPerPilot : 3 * inputs.breaksPerPilot;
  const periodUsed = inputs.manualOverrideMinutes ?? calculatedPeriod;
  const flightStartUtc = dateAndMinutesToUtc(inputs.flightDate, inputs.startMinutes);

  const rows = Array.from({ length: slotCount }, (_, index) => {
    const restStartUtc = addMinutes(flightStartUtc, index * periodUsed);
    const restEndUtc = addMinutes(restStartUtc, periodUsed);
    const deviceAlarm = addMinutes(restEndUtc, inputs.alarmOffsetMinutes);
    return {
      label: `Break ${index + 1}`,
      restStartUtc,
      restEndUtc,
      deviceAlarm,
      durationMinutes: periodUsed
    };
  });

  return {
    inputs,
    adjustedTocMinutes,
    adjustedTodMinutes,
    usableRestMinutes,
    totalRestPerPilot,
    calculatedPeriod,
    periodUsed,
    slotCount,
    rows
  };
}

function render() {
  clearValidation();
  const inputs = readInputs();
  const validation = validateInputs(inputs);

  if (validation.length > 0) {
    latestResult = null;
    renderInvalid(validation);
    return;
  }

  latestResult = calculateRest(inputs);
  renderSummary(latestResult);
  renderSchedule(latestResult);
  updateDeviceClock();
  els.shareStatus.textContent = "";
}

function validateInputs(inputs) {
  const errors = [];
  if (!Number.isFinite(inputs.estimatedTocMinutes)) {
    errors.push({ field: els.tocHours, message: "Select a valid estimated TOC." });
  }
  if (!Number.isFinite(inputs.estimatedTodMinutes)) {
    errors.push({ field: els.todHours, message: "Select a valid estimated TOD." });
  }
  if (!Number.isFinite(inputs.tocModifierMinutes)) {
    errors.push({ field: els.tocModifier, message: "Enter TOC modifier in minutes." });
  }
  if (!Number.isFinite(inputs.todModifierMinutes)) {
    errors.push({ field: els.todModifier, message: "Enter TOD modifier in minutes." });
  }
  if (!Number.isFinite(inputs.startMinutes)) {
    errors.push({ field: els.startHours, message: "Select a valid UTC start time." });
  }
  if (
    els.manualOverride.value.trim() &&
    !Number.isFinite(inputs.manualOverrideMinutes)
  ) {
    errors.push({ field: els.manualOverride, message: "Enter override as HH:MM." });
  }
  if (!Number.isFinite(inputs.alarmOffsetMinutes)) {
    errors.push({ field: els.alarmOffset, message: "Enter alarm offset in minutes." });
  }
  return errors;
}

function clearValidation() {
  [
    els.tocHours,
    els.tocMinutes,
    els.todHours,
    els.todMinutes,
    els.tocModifier,
    els.todModifier,
    els.startHours,
    els.startMinutes,
    els.manualOverride,
    els.alarmOffset
  ].forEach((field) => field.classList.remove("invalid"));
}

function renderInvalid(errors) {
  errors.forEach((error) => error.field.classList.add("invalid"));
  els.usableRest.textContent = "--:--";
  els.totalPerPilot.textContent = "--:--";
  els.periodUsed.textContent = "--:--";
  els.slotCount.textContent = "0";
  els.scheduleBody.innerHTML = `<tr><td colspan="5">${errors[0].message}</td></tr>`;
  els.scheduleContext.textContent = "";
  els.deviceMessage.textContent = errors[0].message;
  els.deviceMessage.classList.add("warn");
}

function renderSummary(result) {
  els.usableRest.textContent = formatDuration(result.usableRestMinutes);
  els.totalPerPilot.textContent = formatDuration(result.totalRestPerPilot);
  els.periodUsed.textContent = formatDuration(result.periodUsed);
  els.slotCount.textContent = String(result.slotCount);
  els.scheduleContext.textContent = `Rest window ${formatClockMinutes(
    result.adjustedTocMinutes
  )} UTC to ${formatClockMinutes(result.adjustedTodMinutes)} UTC. Schedule starts ${formatClockMinutes(
    result.inputs.startMinutes
  )} UTC. Device alarms use ${result.inputs.deviceTimeZone} (${formatOffsetForDate(
    new Date()
  )}).`;
}

function renderSchedule(result) {
  els.scheduleBody.innerHTML = result.rows
    .map((row) => {
      return `<tr>
        <td>${row.label}</td>
        <td>${formatUtcTime(row.restStartUtc)}</td>
        <td>${formatUtcTime(row.restEndUtc)}</td>
        <td>${formatDeviceTime(row.deviceAlarm)}</td>
        <td>${formatDuration(row.durationMinutes)}</td>
      </tr>`;
    })
    .join("");
}

function updateDeviceClock() {
  const now = new Date();
  els.deviceClock.textContent = formatDeviceTime(now);
  els.currentUtc.textContent = formatUtcClock(now);
  els.deviceOffset.textContent = formatOffsetForDate(now);
  els.deviceMessage.textContent = "Device alarm times are calculated from the current device clock.";
  els.deviceMessage.classList.remove("warn");
}

async function copySchedule() {
  if (!latestResult) {
    return;
  }
  const text = buildScheduleText(latestResult);
  try {
    await navigator.clipboard.writeText(text);
    setStatus("Schedule copied.");
  } catch {
    setStatus("Copy is unavailable in this browser.");
  }
}

function downloadPdf() {
  if (!latestResult) {
    return;
  }
  const file = createPdfFile(latestResult);
  savePdfFile(file);
  setStatus("PDF downloaded.");
}

async function sharePdf() {
  if (!latestResult) {
    return;
  }
  const file = createPdfFile(latestResult);
  const shareData = {
    title: "Pilot Rest Schedule",
    text: "Pilot rest schedule PDF",
    files: [file]
  };

  if (navigator.canShare?.(shareData)) {
    try {
      await navigator.share(shareData);
      setStatus("Share sheet opened.");
    } catch (error) {
      if (error?.name !== "AbortError") {
        savePdfFile(file);
        setStatus("Native sharing is unavailable here, so the PDF was downloaded.");
      }
    }
    return;
  }

  savePdfFile(file);
  setStatus("This browser cannot share PDF files directly, so the PDF was downloaded.");
}

function createPdfFile(result) {
  const lines = buildPdfLines(result);
  const bytes = buildSimplePdf(lines);
  return new File([bytes], `pilot-rest-schedule-${todayUtcIsoDate().replaceAll("-", "")}.pdf`, {
    type: "application/pdf"
  });
}

function savePdfFile(file) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildPdfLines(result) {
  const lines = [
    "PILOT REST SCHEDULE",
    "",
    `Estimated TOC: ${formatClockMinutes(result.inputs.estimatedTocMinutes)} UTC`,
    `TOC modifier: ${formatSignedMinutes(result.inputs.tocModifierMinutes)}`,
    `Estimated TOD: ${formatClockMinutes(result.inputs.estimatedTodMinutes)} UTC`,
    `TOD modifier: ${formatSignedMinutes(result.inputs.todModifierMinutes)}`,
    `Usable rest window: ${formatClockMinutes(result.adjustedTocMinutes)} UTC to ${formatClockMinutes(
      result.adjustedTodMinutes
    )} UTC`,
    `Usable rest: ${formatDuration(result.usableRestMinutes)}`,
    `Schedule start UTC: ${formatClockMinutes(result.inputs.startMinutes)}`,
    `Crew: ${result.inputs.crewCount}`,
    `Breaks per pilot: ${result.inputs.breaksPerPilot}`,
    `Rest period used: ${formatDuration(result.periodUsed)}`,
    `Device time zone: ${result.inputs.deviceTimeZone} (${formatOffsetForDate(new Date())})`,
    `Alarm offset: ${formatSignedMinutes(result.inputs.alarmOffsetMinutes)}`,
    "",
    "Break     Rest Start UTC      Rest End UTC        Device Alarm     Duration",
    "-----     --------------      ------------        ------------     --------"
  ];

  result.rows.forEach((row) => {
    lines.push(
      [
        row.label.padEnd(9),
        formatUtcTime(row.restStartUtc).padEnd(20),
        formatUtcTime(row.restEndUtc).padEnd(20),
        formatDeviceTime(row.deviceAlarm).padEnd(17),
        formatDuration(row.durationMinutes)
      ].join("")
    );
  });

  return lines;
}

function buildScheduleText(result) {
  return buildPdfLines(result).join("\n");
}

function buildSimplePdf(lines) {
  const escapedLines = lines.map(escapePdfText);
  const content = [
    "BT",
    "/F1 12 Tf",
    "54 756 Td",
    "16 TL",
    ...escapedLines.flatMap((line, index) =>
      index === 0 ? [`(${line}) Tj`] : ["T*", `(${line}) Tj`]
    ),
    "ET"
  ].join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>",
    `<< /Length ${byteLength(content)} >>\nstream\n${content}\nendstream`
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF`;
  return new Blob([pdf], { type: "application/pdf" });
}

function escapePdfText(text) {
  return text.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function parseClock(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    return Number.NaN;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return Number.NaN;
  }
  return hours * 60 + minutes;
}

function parseDuration(value) {
  const match = /^(\d{1,2})(?::?(\d{2}))?$/.exec(value.trim());
  if (!match) {
    return Number.NaN;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2] || 0);
  if (minutes > 59) {
    return Number.NaN;
  }
  return hours * 60 + minutes;
}

function parseOptionalDuration(value) {
  return value.trim() ? parseDuration(value) : null;
}

function calculateWindowMinutes(startMinutes, endMinutes) {
  let duration = endMinutes - startMinutes;
  if (duration < 0) {
    duration += MINUTES_PER_DAY;
  }
  return Math.max(duration, 0);
}

function formatDuration(totalMinutes) {
  if (!Number.isFinite(totalMinutes)) {
    return "--:--";
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function formatClockMinutes(minutes) {
  const normalized = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(
    normalized % 60
  ).padStart(2, "0")}`;
}

function formatUtcTime(date) {
  return `${formatUtcClock(date)} UTC`;
}

function formatUtcClock(date) {
  return `${String(date.getUTCHours()).padStart(2, "0")}:${String(
    date.getUTCMinutes()
  ).padStart(2, "0")}`;
}

function formatDeviceTime(date) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    hour12: false
  }).format(date);
}

function formatOffsetForDate(date) {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  const hours = Math.floor(absolute / 60);
  const minutes = absolute % 60;
  return `UTC${sign}${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function formatSignedMinutes(minutes) {
  const sign = minutes > 0 ? "+" : "";
  return `${sign}${minutes} minutes`;
}

function dateAndMinutesToUtc(isoDate, minutes) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 0, minutes, 0, 0));
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
}

function range(start, end) {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function setRadioValue(name, value) {
  const radio = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (radio) {
    radio.checked = true;
  }
}

function getRadioValue(name) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value;
}

function todayUtcIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function getDeviceTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "Device local time";
}

function byteLength(text) {
  return new TextEncoder().encode(text).length;
}

function setStatus(message) {
  els.shareStatus.textContent = message;
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    els.installStatus.textContent = "Browser cache only";
    return;
  }

  navigator.serviceWorker
    .register("./sw.js")
    .then(() => {
      els.installStatus.textContent = "Offline ready";
    })
    .catch(() => {
      els.installStatus.textContent = "Online only";
    });
}
