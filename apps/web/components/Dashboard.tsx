"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	activeWorkday,
	formatDuration,
	taskElapsed,
	type WebRest,
	type WebTask,
	type WebWorkspace,
	type WorkBuddyCommand,
} from "../lib/workspace";

type WorkspaceResponse = { workspace: WebWorkspace | null; error?: string };
type DashboardMode = "dashboard" | "focus";
type FocusFont = "modern" | "mono" | "rounded" | "wide";
type FocusColorShade = keyof typeof suluColors;
type WakeLockHandle = { release: () => Promise<void> };
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

const suluColors = {
	"50": "#f4fce9",
	"100": "#e5f8cf",
	"200": "#cdf1a5",
	"300": "#b8e986",
	"400": "#8cd645",
	"500": "#6dbc26",
	"600": "#53951b",
	"700": "#407219",
	"800": "#365b19",
	"900": "#2f4d1a",
	"950": "#162a09",
} as const;

const WORKSPACE_REFRESH_INTERVAL = 20_000;
const COMMAND_REFRESH_DELAYS = [2_000, 6_000];
const DESKTOP_ONLINE_WINDOW = 45_000;

const focusFonts: Record<FocusFont, { label: string; family: string }> = {
	modern: {
		label: "Сучасний",
		family: "Inter, ui-sans-serif, system-ui, sans-serif",
	},
	mono: {
		label: "Моно",
		family: 'ui-monospace, "Cascadia Mono", "Roboto Mono", monospace',
	},
	rounded: {
		label: "М’який",
		family: 'ui-rounded, "Arial Rounded MT Bold", "Trebuchet MS", sans-serif',
	},
	wide: {
		label: "Широкий",
		family: '"Arial Black", "Helvetica Neue", sans-serif',
	},
};

function taskLabel(task: WebTask): string {
	return task.notes.trim() || task.title.trim() || "Без опису";
}

function restElapsed(rest: WebRest, now: number): number {
	return rest.intervals.reduce(
		(total, interval) =>
			total + Math.max(0, (interval.endedAt ?? now) - interval.startedAt),
		0,
	);
}

function formatTime(timestamp: number, withSeconds = false): string {
	return new Intl.DateTimeFormat("uk-UA", {
		hour: "2-digit",
		minute: "2-digit",
		...(withSeconds ? { second: "2-digit" } : {}),
		hour12: false,
	}).format(timestamp);
}

function formatDate(timestamp: number): string {
	return new Intl.DateTimeFormat("uk-UA", {
		weekday: "long",
		day: "numeric",
		month: "long",
	}).format(timestamp);
}

export function Dashboard({
	initialWorkspace,
	email,
}: {
	initialWorkspace: WebWorkspace | null;
	email: string;
}): React.JSX.Element {
	const [workspace, setWorkspace] = useState(initialWorkspace);
	const [now, setNow] = useState(Date.now());
	const [commandStatus, setCommandStatus] = useState("");
	const [loading, setLoading] = useState(false);
	const [switcherOpen, setSwitcherOpen] = useState(false);
	const [mode, setMode] = useState<DashboardMode>("dashboard");
	const [focusSettingsOpen, setFocusSettingsOpen] = useState(false);
	const [focusShowSeconds, setFocusShowSeconds] = useState(true);
	const [focusShowContext, setFocusShowContext] = useState(true);
	const [focusBrightness, setFocusBrightness] = useState(100);
	const [focusFont, setFocusFont] = useState<FocusFont>("modern");
	const [focusScale, setFocusScale] = useState(100);
	const [focusColorShade, setFocusColorShade] = useState<FocusColorShade>("300");
	const [focusAutoHide, setFocusAutoHide] = useState(true);
	const [focusControlsVisible, setFocusControlsVisible] = useState(true);
	const [focusKeepAwake, setFocusKeepAwake] = useState(true);
	const [focusAmoled, setFocusAmoled] = useState(true);
	const [focusDrift, setFocusDrift] = useState(true);
	const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
	const commandInFlight = useRef(false);

	const refreshWorkspace = useCallback(async (): Promise<void> => {
		try {
			const response = await fetch("/api/workspace", { cache: "no-store" });
			const data = (await response
				.json()
				.catch(() => null)) as WorkspaceResponse | null;
			if (response.ok && data) setWorkspace(data.workspace);
		} catch {
			// Keep the last known workspace when the connection is temporarily unavailable.
		}
	}, []);

	useEffect(() => {
		const savedMode = window.localStorage.getItem("work-buddy-dashboard-mode");
		if (savedMode === "focus" || savedMode === "dashboard") setMode(savedMode);
		setFocusShowSeconds(
			window.localStorage.getItem("work-buddy-focus-seconds") !== "false",
		);
		setFocusShowContext(
			window.localStorage.getItem("work-buddy-focus-context") !== "false",
		);
		const savedBrightness = Number(
			window.localStorage.getItem("work-buddy-focus-brightness"),
		);
		if (
			Number.isFinite(savedBrightness) &&
			savedBrightness >= 35 &&
			savedBrightness <= 130
		)
			setFocusBrightness(savedBrightness);
		const savedFont = window.localStorage.getItem("work-buddy-focus-font");
		if (savedFont && savedFont in focusFonts)
			setFocusFont(savedFont as FocusFont);
		const savedScale = Number(
			window.localStorage.getItem("work-buddy-focus-scale"),
		);
		if (Number.isFinite(savedScale) && savedScale >= 70 && savedScale <= 225)
			setFocusScale(savedScale);
		const savedColorShade = window.localStorage.getItem(
			"work-buddy-focus-color-shade",
		);
		if (savedColorShade && savedColorShade in suluColors)
			setFocusColorShade(savedColorShade as FocusColorShade);
		setFocusAutoHide(window.localStorage.getItem("work-buddy-focus-auto-hide") !== "false");
		setFocusKeepAwake(window.localStorage.getItem("work-buddy-focus-wake-lock") !== "false");
		setFocusAmoled(window.localStorage.getItem("work-buddy-focus-amoled") !== "false");
		setFocusDrift(window.localStorage.getItem("work-buddy-focus-drift") !== "false");
		const clock = window.setInterval(() => setNow(Date.now()), 1_000);
		return () => {
			window.clearInterval(clock);
		};
	}, []);

	useEffect(() => {
		let syncTimer: number | undefined;
		let refreshing = false;
		const refresh = async (): Promise<void> => {
			if (refreshing) return;
			refreshing = true;
			try {
				await refreshWorkspace();
			} finally {
				refreshing = false;
			}
		};
		const stopPolling = (): void => {
			if (syncTimer) window.clearInterval(syncTimer);
			syncTimer = undefined;
		};
		const startPolling = (): void => {
			if (document.visibilityState !== "visible") return;
			void refresh();
			syncTimer = window.setInterval(
				() => void refresh(),
				WORKSPACE_REFRESH_INTERVAL,
			);
		};
		const onVisibilityChange = (): void => {
			stopPolling();
			startPolling();
		};

		startPolling();
		document.addEventListener("visibilitychange", onVisibilityChange);
		return () => {
			stopPolling();
			document.removeEventListener("visibilitychange", onVisibilityChange);
		};
	}, [refreshWorkspace]);

	useEffect(() => {
		const onBeforeInstall = (event: Event): void => {
			event.preventDefault();
			setInstallPrompt(event as InstallPromptEvent);
		};
		const onInstalled = (): void => setInstallPrompt(null);
		window.addEventListener("beforeinstallprompt", onBeforeInstall);
		window.addEventListener("appinstalled", onInstalled);
		return () => {
			window.removeEventListener("beforeinstallprompt", onBeforeInstall);
			window.removeEventListener("appinstalled", onInstalled);
		};
	}, []);

	const setDashboardMode = (nextMode: DashboardMode): void => {
		setMode(nextMode);
		window.localStorage.setItem("work-buddy-dashboard-mode", nextMode);
	};

	useEffect(() => {
		if (mode !== "focus" || !focusAutoHide) {
			setFocusControlsVisible(true);
			return;
		}
		let hideTimer: number | undefined;
		const showControls = (): void => {
			setFocusControlsVisible(true);
			if (hideTimer) window.clearTimeout(hideTimer);
			hideTimer = window.setTimeout(() => {
				if (!focusSettingsOpen) setFocusControlsVisible(false);
			}, 8_000);
		};
		showControls();
		window.addEventListener("pointerdown", showControls);
		window.addEventListener("pointermove", showControls);
		window.addEventListener("keydown", showControls);
		return () => {
			if (hideTimer) window.clearTimeout(hideTimer);
			window.removeEventListener("pointerdown", showControls);
			window.removeEventListener("pointermove", showControls);
			window.removeEventListener("keydown", showControls);
		};
	}, [focusAutoHide, focusSettingsOpen, mode]);

	useEffect(() => {
		if (mode !== "focus" || !focusKeepAwake || !("wakeLock" in navigator)) return;
		let released = false;
		let lock: WakeLockHandle | null = null;
		const request = async (): Promise<void> => {
			if (document.visibilityState !== "visible") return;
			try {
				const wakeLock = (navigator as Navigator & { wakeLock: { request: (type: "screen") => Promise<WakeLockHandle> } }).wakeLock;
				lock = await wakeLock.request("screen");
				if (released) await lock.release();
			} catch { /* Wake Lock is optional and can be rejected by the device. */ }
		};
		const onVisibilityChange = (): void => { if (!lock) void request(); };
		void request();
		document.addEventListener("visibilitychange", onVisibilityChange);
		return () => {
			released = true;
			document.removeEventListener("visibilitychange", onVisibilityChange);
			void lock?.release();
		};
	}, [focusKeepAwake, mode]);

	const projectById = useMemo(
		() =>
			new Map(
				workspace?.projects.map((project) => [project.id, project]) ?? [],
			),
		[workspace],
	);
	const activeRest = workspace?.rests.find(
		(rest) => rest.status !== "completed",
	);
	const activeTasks =
		workspace?.tasks.filter((task) => task.status !== "stopped") ?? [];
	const runningTasks = activeTasks.filter((task) => task.status === "running");
	const primaryTask = runningTasks[0] ?? activeTasks[0];
	const primaryProject = primaryTask?.projectId
		? projectById.get(primaryTask.projectId)
		: undefined;
	const workday = workspace ? activeWorkday(workspace) : undefined;
	const desktopOnline = Boolean(
		workspace?.exportedAt && now - workspace.exportedAt <= DESKTOP_ONLINE_WINDOW,
	);
	const controlsDisabled = loading || !desktopOnline;
	const heroDuration = activeRest
		? restElapsed(activeRest, now)
		: primaryTask
			? taskElapsed(primaryTask, now)
			: 0;
	const heroTitle = activeRest
		? activeRest.type === "lunch"
			? "Твій обід"
			: "Твоя перерва"
		: primaryTask
			? taskLabel(primaryTask)
			: "Поки тихо";
	const heroProject = activeRest
		? "Час для себе"
		: primaryProject?.name || "Вільний фокус";
	const projectFocusColor = activeRest
		? "#f7a072"
		: primaryProject?.color || "#b8e986";
	const focusColor = mode === "focus" ? suluColors[focusColorShade] : projectFocusColor;
	const focusUsesWorkTimer = Boolean(workday);
	const focusMainTime = focusUsesWorkTimer
		? formatDuration(heroDuration)
		: formatTime(now, focusShowSeconds);
	const focusTitle = focusUsesWorkTimer ? heroTitle : "Твій час";
	const focusProject = focusUsesWorkTimer ? heroProject : "Work Buddy";
	const focusState = focusUsesWorkTimer
		? activeRest
			? "Відпочинок іде"
			: runningTasks.length
				? `${runningTasks.length} активн${runningTasks.length === 1 ? "а задача" : "і задачі"}`
				: "Обери задачу на десктопі"
		: "Робочий день завершено";

	const send = async (command: WorkBuddyCommand): Promise<void> => {
		if (!desktopOnline) {
			setCommandStatus("Десктоп зараз офлайн — команда не була надіслана.");
			return;
		}
		if (commandInFlight.current) return;
		commandInFlight.current = true;
		setLoading(true);
		setCommandStatus("");
		try {
			const response = await fetch("/api/commands", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(command),
			});
			const data = (await response.json().catch(() => null)) as {
				error?: string;
			} | null;
			if (!response.ok)
				throw new Error(data?.error || "Не вдалося надіслати команду");
			setCommandStatus("Команда надіслана — Work Buddy підхопить її за мить.");
			COMMAND_REFRESH_DELAYS.forEach((delay) => {
				window.setTimeout(() => void refreshWorkspace(), delay);
			});
		} catch (error) {
			setCommandStatus(
				error instanceof Error ? error.message : "Не вдалося надіслати команду",
			);
		} finally {
			commandInFlight.current = false;
			setLoading(false);
		}
	};

	const dayActions = (): React.JSX.Element =>
		activeRest ? (
			<button
				className="primary-button"
				disabled={controlsDisabled}
				onClick={() =>
					void send({ command: "complete-rest", restId: activeRest.id })
				}
			>
				Завершити {activeRest.type === "lunch" ? "обід" : "перерву"}
			</button>
		) : (
			<>
				<button
					disabled={controlsDisabled || !workday}
					onClick={() =>
						void send({ command: "start-rest", restType: "lunch" })
					}
				>
					Почати обід
				</button>
				<button
					className="danger-button"
					disabled={controlsDisabled || !workday}
					onClick={() => workday && void send({ command: "end-workday", workdayId: workday.id })}
				>
					Завершити день
				</button>
			</>
		);

	if (!workspace)
		return (
			<main className="setup-card">
				<p className="eyebrow">Work Buddy Web</p>
				<h1>Чекаю першу синхронізацію</h1>
				<p>
					Відкрий десктопний Work Buddy і виконай синхронізацію з Sanity. Після
					цього цей екран оживе сам.
				</p>
			</main>
		);

	const updateFocusSetting = (
		key: "seconds" | "context",
		value: boolean,
	): void => {
		if (key === "seconds") setFocusShowSeconds(value);
		else setFocusShowContext(value);
		window.localStorage.setItem(`work-buddy-focus-${key}`, String(value));
	};

	const updateFocusBrightness = (value: number): void => {
		setFocusBrightness(value);
		window.localStorage.setItem("work-buddy-focus-brightness", String(value));
	};

	const updateFocusFont = (value: FocusFont): void => {
		setFocusFont(value);
		window.localStorage.setItem("work-buddy-focus-font", value);
	};

	const updateFocusScale = (value: number): void => {
		setFocusScale(value);
		window.localStorage.setItem("work-buddy-focus-scale", String(value));
	};

	const updateFocusColorShade = (value: FocusColorShade): void => {
		setFocusColorShade(value);
		window.localStorage.setItem("work-buddy-focus-color-shade", value);
	};

	const updateDisplayBoolean = (
		key: "auto-hide" | "wake-lock" | "amoled" | "drift",
		value: boolean,
	): void => {
		if (key === "auto-hide") setFocusAutoHide(value);
		if (key === "wake-lock") setFocusKeepAwake(value);
		if (key === "amoled") setFocusAmoled(value);
		if (key === "drift") setFocusDrift(value);
		window.localStorage.setItem(`work-buddy-focus-${key}`, String(value));
	};

	const installAsApp = async (): Promise<void> => {
		if (!installPrompt) return;
		await installPrompt.prompt();
		const result = await installPrompt.userChoice;
		if (result.outcome !== "accepted") setCommandStatus("Встановлення скасовано.");
		setInstallPrompt(null);
	};

	return (
		<main
			className={`dashboard-shell dashboard-shell--${mode}`}
			style={
				{
					"--focus-color": focusColor,
					"--focus-brightness": String(focusBrightness / 100),
					"--focus-font": focusFonts[focusFont].family,
					"--focus-scale": String(focusScale / 100),
				} as React.CSSProperties
			}
		>
			{mode === "dashboard" && (
				<header className="dashboard-header">
					<div className="brand-block">
						<p className="eyebrow">Work Buddy · live</p>
						<p className="today-label">{formatDate(now)}</p>
					</div>
					<div className="header-actions">
						<span className={`live-chip ${desktopOnline ? "" : "is-offline"}`}>
							<i />
							{desktopOnline ? "desktop онлайн" : "desktop офлайн"}
						</span>
						<div className="view-switcher" aria-label="Режим дашборду">
							<button
								className="is-active"
								onClick={() => setDashboardMode("dashboard")}
								aria-label="Звичайний дашборд"
							>
								▦<span>Дашборд</span>
							</button>
							<button
								onClick={() => setDashboardMode("focus")}
								aria-label="Focus Clock"
							>
								◷<span>Focus</span>
							</button>
						</div>
					</div>
				</header>
			)}

			{mode === "focus" ? (
				<section className={`focus-clock ${focusAmoled ? "focus-clock--amoled" : ""}`} aria-label="Focus Clock">
					{focusUsesWorkTimer && (
						<p className="focus-wall-clock">{formatTime(now)}</p>
					)}
					<div className={`focus-controls focus-ui ${focusControlsVisible ? "" : "is-hidden"}`}>
						<button
							className="focus-icon-button"
							onClick={() => updateDisplayBoolean("amoled", !focusAmoled)}
							aria-label={focusAmoled ? "Вимкнути AMOLED-режим" : "Увімкнути AMOLED-режим"}
						>
							{focusAmoled ? "◐" : "☀"}
						</button>
						<button
							className="focus-icon-button"
							onClick={() => setFocusSettingsOpen((open) => !open)}
							aria-label="Налаштування Focus Clock"
							aria-expanded={focusSettingsOpen}
						>
							⚙
						</button>
						<button
							className="focus-icon-button"
							onClick={() => setDashboardMode("dashboard")}
							aria-label="Відкрити дашборд"
						>
							▦
						</button>
					</div>
					{focusSettingsOpen && (
						<aside
							className="focus-settings"
							aria-label="Налаштування годинника"
						>
							<div>
								<p className="eyebrow">Focus Clock</p>
								<button
									onClick={() => setFocusSettingsOpen(false)}
									aria-label="Закрити налаштування"
								>
									×
								</button>
							</div>
							{installPrompt && <button className="focus-install-button" onClick={() => void installAsApp()}>Встановити для нічного екрана</button>}
							<label>
								<span>Секунди у звичайному годиннику</span>
								<input
									type="checkbox"
									checked={focusShowSeconds}
									onChange={(event) =>
										updateFocusSetting("seconds", event.target.checked)
									}
								/>
							</label>
							<label>
								<span>Показувати контекст задачі</span>
								<input
									type="checkbox"
									checked={focusShowContext}
									onChange={(event) =>
										updateFocusSetting("context", event.target.checked)
									}
								/>
							</label>
							<label>
								<span>Ховати кнопки через 8 секунд</span>
								<input type="checkbox" checked={focusAutoHide} onChange={(event) => updateDisplayBoolean("auto-hide", event.target.checked)} />
							</label>
							<label>
								<span>Не вимикати екран</span>
								<input type="checkbox" checked={focusKeepAwake} onChange={(event) => updateDisplayBoolean("wake-lock", event.target.checked)} />
							</label>
							<label>
								<span>AMOLED: чистий чорний фон</span>
								<input type="checkbox" checked={focusAmoled} onChange={(event) => updateDisplayBoolean("amoled", event.target.checked)} />
							</label>
							<label>
								<span>Повільний рух від вигорання</span>
								<input type="checkbox" checked={focusDrift} onChange={(event) => updateDisplayBoolean("drift", event.target.checked)} />
							</label>
							<label className="focus-range">
								<span>
									Яскравість цифр <b>{focusBrightness}%</b>
								</span>
								<input
									type="range"
									min="35"
									max="130"
									step="5"
									value={focusBrightness}
									onChange={(event) =>
										updateFocusBrightness(Number(event.target.value))
									}
								/>
							</label>
							<label className="focus-range">
								<span>
									Розмір годинника <b>{focusScale}%</b>
								</span>
								<input
									type="range"
									min="70"
									max="225"
									step="5"
									value={focusScale}
									onChange={(event) =>
										updateFocusScale(Number(event.target.value))
									}
								/>
							</label>
							<label className="focus-font-select">
								<span>Шрифт цифр</span>
								<select
									value={focusFont}
									onChange={(event) =>
										updateFocusFont(event.target.value as FocusFont)
									}
								>
									{Object.entries(focusFonts).map(([value, font]) => (
										<option key={value} value={value}>
											{font.label}
										</option>
									))}
								</select>
							</label>
							<fieldset className="focus-color-selector">
								<legend>Колір Focus Clock</legend>
								<div>
									{Object.entries(suluColors).map(([shade, color]) => (
										<button
											key={shade}
											type="button"
											className={
												focusColorShade === shade ? "is-selected" : ""
											}
											style={{ "--swatch-color": color } as React.CSSProperties}
											onClick={() => updateFocusColorShade(shade as FocusColorShade)}
											aria-label={`Sulu ${shade}`}
											aria-pressed={focusColorShade === shade}
										>
											<span>{shade}</span>
										</button>
									))}
								</div>
							</fieldset>
						</aside>
					)}
					<div className="focus-orbit focus-orbit--one" />
					<div className="focus-orbit focus-orbit--two" />
					<div className={`focus-content ${focusAmoled && focusDrift ? "focus-content--drift" : ""}`}>
						{focusShowContext && (
							<>
								<p className="focus-project">{focusProject}</p>
								<h1>{focusTitle}</h1>
							</>
						)}
						<strong>{focusMainTime}</strong>
						{focusShowContext && <p className="focus-state">{focusState}</p>}
					</div>
					<div className={`focus-dock focus-ui ${focusControlsVisible ? "" : "is-hidden"}`}>
						{activeRest ? (
							dayActions()
						) : primaryTask ? (
							<button
								className={
									primaryTask.status === "running" ? "primary-button" : ""
								}
								disabled={controlsDisabled}
								onClick={() =>
									void send(
										primaryTask.status === "running"
											? { command: "pause-task", taskId: primaryTask.id }
											: { command: "resume-task", taskId: primaryTask.id, mode: "parallel" },
									)
								}
							>
								{primaryTask.status === "running" ? "Ⅱ Пауза" : "▶ Продовжити"}
							</button>
						) : null}
						{!activeRest && workday && (
							<button
								disabled={controlsDisabled}
								onClick={() =>
									void send({ command: "start-rest", restType: "break" })
								}
							>
								Перерва
							</button>
						)}
					</div>
					{focusUsesWorkTimer && (
						<div className={`focus-task-rail focus-ui ${focusControlsVisible ? "" : "is-hidden"}`}>
							{activeTasks.slice(0, 4).map((task) => {
								const project = task.projectId
									? projectById.get(task.projectId)
									: undefined;
								return (
									<span
										key={task.id}
										className={task.status === "running" ? "is-running" : ""}
										style={
											{
												"--project": project?.color ?? "#b8e986",
											} as React.CSSProperties
										}
									>
										{project?.name || taskLabel(task)}
									</span>
								);
							})}
						</div>
					)}
				</section>
			) : (
				<>
					<section className="workday-card">
						<div className="dashboard-grid">
						<article className="hero-clock">
							<div className="hero-clock__top">
								<p>
									{activeRest
										? activeRest.type === "lunch"
											? "Зараз обід"
											: "Зараз перерва"
										: primaryProject?.name ||
											(workday ? "Поточний фокус" : "Статус дня")}
								</p>
								<span>{formatTime(now)}</span>
							</div>
							<strong>{formatDuration(heroDuration)}</strong>
							<h1>{heroTitle}</h1>
							<div className="hero-clock__foot">
								<span className={runningTasks.length ? "pulse-dot" : ""} />
								{activeRest
									? "Відлік твого відпочинку"
									: runningTasks.length
										? `${runningTasks.length} задачі зараз у роботі`
										: workday
											? "Задачі чекають на старт"
											: "День ще не почався"}
							</div>
						</article>
						<aside className="day-overview">
							<div className="overview-head">
								<p className="eyebrow">Сьогодні</p>
								<span>{workday ? "у процесі" : "вільно"}</span>
							</div>
							<div className="overview-stat">
								<small>Старт дня</small>
								<strong>{workday ? formatTime(workday.startedAt) : "—"}</strong>
							</div>
							<div className="overview-stat">
								<small>Активні задачі</small>
								<strong>{runningTasks.length}</strong>
							</div>
							<div className="overview-stat">
								<small>Відпочинок</small>
								<strong>
									{activeRest
										? formatDuration(restElapsed(activeRest, now))
										: "—"}
								</strong>
							</div>
							<div className="day-pulse">
								<i />
								<span>
									{workday
										? "Синхронізовано з десктопом"
										: "Почни день у Work Buddy"}
								</span>
							</div>
						</aside>
						</div>
						<section className="quick-actions" aria-label="Швидкі дії">
							{activeRest ? (
								<button
									className="primary-button"
									disabled={controlsDisabled}
									onClick={() =>
										void send({ command: "complete-rest", restId: activeRest.id })
									}
								>
									Завершити {activeRest.type === "lunch" ? "обід" : "перерву"}
								</button>
							) : (
								<>
									<button
										className="primary-button"
										disabled={controlsDisabled}
										onClick={() =>
											void send({ command: "start-task", mode: "parallel" })
										}
									>
										＋ Паралельна задача
									</button>
									<button
										disabled={controlsDisabled}
										onClick={() => setSwitcherOpen((open) => !open)}
										aria-expanded={switcherOpen}
										aria-controls="task-switcher"
									>
										⇄ Перемкнутися
									</button>
									<button
										disabled={controlsDisabled || !workday}
										onClick={() =>
											void send({ command: "start-rest", restType: "break" })
										}
									>
										☕ Взяти перерву
									</button>
								</>
							)}
						</section>
						{!activeRest && (
							<section className="day-actions" aria-label="Дії робочого дня">
								{dayActions()}
							</section>
						)}
					</section>
					{switcherOpen && !activeRest && (
						<section
							className="task-switcher"
							id="task-switcher"
							aria-label="Перемикання задачі"
						>
							<div>
								<p className="eyebrow">Змінити фокус</p>
								<h2>На яку задачу перемкнутися?</h2>
							</div>
							<div className="task-switcher__choices">
								<button
									disabled={controlsDisabled}
									onClick={() => {
										setSwitcherOpen(false);
										void send({ command: "start-task", mode: "switch" });
									}}
								>
									＋ Нова задача
								</button>
								{activeTasks.map((task) => (
									<button
										key={task.id}
										disabled={controlsDisabled}
										onClick={() => {
											setSwitcherOpen(false);
											void send({
												command: "resume-task",
												taskId: task.id,
												mode: "switch",
											});
										}}
									>
										<span>{taskLabel(task)}</span>
										<small>
											{task.status === "running" ? "зараз активна" : "продовжити"}
										</small>
									</button>
								))}
							</div>
						</section>
					)}
					{commandStatus && <p className="command-status">{commandStatus}</p>}
					<section className="tasks-panel">
						<div className="section-heading">
							<div>
								<p className="eyebrow">У роботі</p>
								<h2>Активні задачі</h2>
							</div>
							<span>{activeTasks.length}</span>
						</div>
						{activeTasks.length ? (
							<div className="task-list">
								{activeTasks.map((task) => {
									const project = task.projectId
										? projectById.get(task.projectId)
										: undefined;
									const running = task.status === "running";
									return (
										<article
											className={`task-card ${running ? "task-card--running" : ""}`}
											key={task.id}
											style={
												{
													"--project": project?.color ?? "#b8e986",
												} as React.CSSProperties
											}
										>
											<div className="task-card__project-mark" />
											<div className="task-card__content">
												<p className="project-name">
													{project?.name || "Без проєкту"}
												</p>
												<h3>{taskLabel(task)}</h3>
												<strong>
													{formatDuration(taskElapsed(task, now))}
												</strong>
											</div>
											<button
												className={running ? "pause-button" : "play-button"}
												disabled={controlsDisabled}
												onClick={() =>
													void send(
														running
															? { command: "pause-task", taskId: task.id }
															: { command: "resume-task", taskId: task.id, mode: "parallel" },
													)
												}
												aria-label={
													running ? "Поставити на паузу" : "Продовжити"
												}
											>
												{running ? "Ⅱ" : "▶"}
											</button>
										</article>
									);
								})}
							</div>
						) : (
							<p className="empty-state">
								Поки тихо. Запусти першу задачу на десктопі.
							</p>
						)}
					</section>
				</>
			)}
			{mode === "dashboard" && <p className="account-label">{email}</p>}
		</main>
	);
}
