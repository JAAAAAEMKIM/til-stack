import { createRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Trash2,
  Plus,
  Star,
  Loader2,
  Bell,
  X,
  Pencil,
  Monitor,
  Sun,
  Moon,
  Sparkles,
  Download,
  Check,
  AlertCircle,
  RotateCcw,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useTheme, type Theme } from "@/lib/theme";
import { useAIConfig, AI_BACKENDS, WEBLLM_MODELS, type AIBackend } from "@/lib/ai-config";
import { useSummarizer, type SummarizerStatus } from "@/lib/summarizer";
import { rootRoute } from "./__root";

export const configRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/config",
  component: ConfigPage,
});

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function ConfigPage() {
  return (
    <div className="space-y-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold">Settings</h1>

      <AppearanceSection />
      <AISection />
      <SkipDaysSection />
      <TemplatesSection />
      <NotificationsSection />
    </div>
  );
}

const THEME_OPTIONS: { value: Theme; label: string; icon: typeof Monitor }[] = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

function AppearanceSection() {
  const { theme, setTheme } = useTheme();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
        <CardDescription>Choose your preferred theme</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex gap-2">
          {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
            <Button
              key={value}
              variant={theme === value ? "default" : "outline"}
              className="flex-1"
              onClick={() => setTheme(value)}
            >
              <Icon className="h-4 w-4 mr-2" />
              {label}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function getStatusLabel(status: SummarizerStatus): { label: string; color: string } {
  switch (status) {
    case "ready":
      return { label: "Ready", color: "text-green-600" };
    case "idle":
      return { label: "Not loaded", color: "text-yellow-600" };
    case "loading":
      return { label: "Loading...", color: "text-blue-600" };
    case "generating":
      return { label: "Generating...", color: "text-blue-600" };
    case "unavailable":
    default:
      return { label: "Not available", color: "text-muted-foreground" };
  }
}

function AISection() {
  const {
    config,
    setEnabled,
    setBackend,
    setWebllmModel,
    setGroqApiKey,
    setGoogleAiApiKey,
    setWeeklyPrompt,
    resetPrompt,
    DEFAULT_WEEKLY_PROMPT,
  } = useAIConfig();
  const { status, progress, progressText, initDownload } = useSummarizer();
  const [promptValue, setPromptValue] = useState(config.weeklyPrompt);
  const [hasChanges, setHasChanges] = useState(false);

  // Sync promptValue when config changes
  useEffect(() => {
    setPromptValue(config.weeklyPrompt);
    setHasChanges(false);
  }, [config.weeklyPrompt]);

  const handlePromptChange = (value: string) => {
    setPromptValue(value);
    setHasChanges(value !== config.weeklyPrompt);
  };

  const handleSavePrompt = () => {
    setWeeklyPrompt(promptValue);
    setHasChanges(false);
  };

  const handleResetPrompt = () => {
    resetPrompt();
    setPromptValue(DEFAULT_WEEKLY_PROMPT);
    setHasChanges(false);
  };

  const statusInfo = getStatusLabel(status);
  const isModelReady = status === "ready";
  const isLoading = status === "loading";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5" />
          AI Features
        </CardTitle>
        <CardDescription>
          Generate AI summaries for your weekly entries
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Enable toggle */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Enable AI Summaries</div>
            <div className="text-xs text-muted-foreground">
              Show AI-generated summaries in weekly view
            </div>
          </div>
          <Button
            variant={config.enabled ? "default" : "outline"}
            size="sm"
            onClick={() => setEnabled(!config.enabled)}
          >
            {config.enabled ? (
              <>
                <Check className="h-4 w-4 mr-1" />
                Enabled
              </>
            ) : (
              "Disabled"
            )}
          </Button>
        </div>

        {config.enabled && (
          <>
            {/* Backend Selection */}
            <div className="space-y-3">
              <label className="text-sm font-medium">AI Backend</label>
              <div className="grid gap-2">
                {AI_BACKENDS.map((backend) => (
                  <button
                    key={backend.id}
                    onClick={() => !backend.disabled && setBackend(backend.id)}
                    disabled={backend.disabled}
                    className={`
                      flex items-center justify-between p-3 rounded-lg border text-left
                      transition-colors
                      ${backend.disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:bg-accent"}
                      ${config.backend === backend.id ? "border-primary bg-accent" : "border-border"}
                    `}
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{backend.name}</span>
                        {backend.disabled && (
                          <span className="text-xs bg-muted px-1.5 py-0.5 rounded">
                            WIP
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {backend.description}
                      </p>
                    </div>
                    {config.backend === backend.id && !backend.disabled && (
                      <Check className="h-4 w-4 text-primary" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* WebLLM Model Selection */}
            {config.backend === "webllm" && (
              <div className="space-y-3">
                <label className="text-sm font-medium">WebLLM Model</label>
                <div className="grid gap-2">
                  {WEBLLM_MODELS.map((model) => (
                    <button
                      key={model.id}
                      onClick={() => setWebllmModel(model.id)}
                      className={`
                        flex items-center justify-between p-3 rounded-lg border text-left
                        transition-colors cursor-pointer hover:bg-accent
                        ${config.webllmModel === model.id ? "border-primary bg-accent" : "border-border"}
                      `}
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{model.name}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {model.description}
                        </p>
                      </div>
                      {config.webllmModel === model.id && (
                        <Check className="h-4 w-4 text-primary" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Groq API Key */}
            {config.backend === "groq" && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Groq API Key</label>
                <input
                  type="password"
                  value={config.groqApiKey}
                  onChange={(e) => setGroqApiKey(e.target.value)}
                  placeholder="gsk_..."
                  className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  Get your free API key at{" "}
                  <a
                    href="https://console.groq.com/keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline"
                  >
                    console.groq.com
                  </a>
                </p>
              </div>
            )}

            {/* Google AI API Key */}
            {config.backend === "google-ai" && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Google AI API Key</label>
                <input
                  type="password"
                  value={config.googleAiApiKey}
                  onChange={(e) => setGoogleAiApiKey(e.target.value)}
                  placeholder="AIza..."
                  className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  Get your free API key at{" "}
                  <a
                    href="https://aistudio.google.com/apikey"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline"
                  >
                    aistudio.google.com
                  </a>
                </p>
              </div>
            )}

            {/* Status - only for local models */}
            {(config.backend === "gemini-nano" || config.backend === "webllm") && (
              <>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">Status:</span>
                    <span className={`text-sm font-medium ${statusInfo.color}`}>
                      {statusInfo.label}
                    </span>
                    {isLoading && progress > 0 && (
                      <span className="text-xs text-muted-foreground">
                        ({Math.round(progress * 100)}%)
                      </span>
                    )}
                  </div>
                  {status === "idle" && (
                    <Button size="sm" variant="outline" onClick={initDownload}>
                      <Download className="h-4 w-4 mr-1" />
                      Load Model
                    </Button>
                  )}
                  {isLoading && (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}
                </div>

                {/* Loading progress text */}
                {isLoading && progressText && (
                  <p className="text-xs text-muted-foreground truncate">
                    {progressText}
                  </p>
                )}
              </>
            )}

            {/* Weekly prompt */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Summary Prompt</label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleResetPrompt}
                  className="h-7 text-xs"
                >
                  <RotateCcw className="h-3 w-3 mr-1" />
                  Reset
                </Button>
              </div>
              <Textarea
                value={promptValue}
                onChange={(e) => handlePromptChange(e.target.value)}
                placeholder="Enter your custom prompt..."
                className="min-h-[100px] font-mono text-sm"
              />
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  This context helps the AI understand your entries
                </p>
                {hasChanges && (
                  <Button size="sm" onClick={handleSavePrompt}>
                    Save Prompt
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SkipDaysSection() {
  const utils = trpc.useUtils();
  const { data: skipDays, isLoading } = trpc.config.getSkipDays.useQuery();
  const [newDate, setNewDate] = useState("");

  const addWeekdayMutation = trpc.config.addSkipWeekday.useMutation({
    onSuccess: () => utils.config.getSkipDays.invalidate(),
  });

  const addDateMutation = trpc.config.addSkipDate.useMutation({
    onSuccess: () => {
      utils.config.getSkipDays.invalidate();
      setNewDate("");
    },
  });

  const removeMutation = trpc.config.removeSkipDay.useMutation({
    onSuccess: () => utils.config.getSkipDays.invalidate(),
  });

  const toggleWeekday = (weekday: number) => {
    const isSkipped = skipDays?.weekdays.includes(weekday);
    if (isSkipped) {
      const item = skipDays?.raw.find(
        (s) => s.type === "weekday" && s.value === weekday.toString()
      );
      if (item) removeMutation.mutate({ id: item.id });
    } else {
      addWeekdayMutation.mutate({ weekday });
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 flex justify-center">
          <Loader2 className="animate-spin" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Days to Skip</CardTitle>
        <CardDescription>
          Configure which days to skip when navigating between entries
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Recurring weekdays */}
        <div>
          <h3 className="text-sm font-medium mb-3">Recurring Weekdays</h3>
          <div className="flex flex-wrap gap-2">
            {WEEKDAY_NAMES.map((name, index) => (
              <Button
                key={index}
                variant={skipDays?.weekdays.includes(index) ? "default" : "outline"}
                size="sm"
                onClick={() => toggleWeekday(index)}
                disabled={addWeekdayMutation.isPending || removeMutation.isPending}
              >
                {name.slice(0, 3)}
              </Button>
            ))}
          </div>
        </div>

        {/* Specific dates */}
        <div>
          <h3 className="text-sm font-medium mb-3">Specific Dates</h3>
          <div className="flex gap-2 mb-3">
            <input
              type="date"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
              className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
            />
            <Button
              size="sm"
              onClick={() => newDate && addDateMutation.mutate({ date: newDate })}
              disabled={!newDate || addDateMutation.isPending}
            >
              <Plus className="h-4 w-4 mr-1" /> Add
            </Button>
          </div>

          {skipDays?.specificDates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No specific dates configured
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {skipDays?.raw
                .filter((s) => s.type === "specific_date")
                .sort((a, b) => a.value.localeCompare(b.value))
                .map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-1 px-3 py-1 bg-secondary rounded-md text-sm"
                  >
                    {item.value}
                    <button
                      onClick={() => removeMutation.mutate({ id: item.id })}
                      className="ml-1 hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function TemplatesSection() {
  const utils = trpc.useUtils();
  const { data: templates, isLoading } = trpc.config.getTemplates.useQuery();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newTemplate, setNewTemplate] = useState({ name: "", content: "" });
  const [editForm, setEditForm] = useState({ name: "", content: "" });
  const [isCreating, setIsCreating] = useState(false);

  const createMutation = trpc.config.createTemplate.useMutation({
    onSuccess: () => {
      utils.config.getTemplates.invalidate();
      utils.config.getDefaultTemplate.invalidate();
      setNewTemplate({ name: "", content: "" });
      setIsCreating(false);
    },
  });

  const updateMutation = trpc.config.updateTemplate.useMutation({
    onSuccess: () => {
      utils.config.getTemplates.invalidate();
      setEditingId(null);
    },
  });

  const deleteMutation = trpc.config.deleteTemplate.useMutation({
    onSuccess: () => {
      utils.config.getTemplates.invalidate();
      utils.config.getDefaultTemplate.invalidate();
    },
  });

  const setDefaultMutation = trpc.config.setDefaultTemplate.useMutation({
    onSuccess: () => {
      utils.config.getTemplates.invalidate();
      utils.config.getDefaultTemplate.invalidate();
    },
  });

  const startEdit = (template: { id: string; name: string; content: string }) => {
    setEditingId(template.id);
    setEditForm({ name: template.name, content: template.content });
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 flex justify-center">
          <Loader2 className="animate-spin" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Templates</CardTitle>
        <CardDescription>Create templates for new entries</CardDescription>
        {!isCreating && (
          <Button size="sm" className="w-fit mt-2" onClick={() => setIsCreating(true)}>
            <Plus className="h-4 w-4 mr-1" /> New Template
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Create new template form */}
        {isCreating && (
          <div className="border rounded-lg p-4 space-y-3">
            <input
              type="text"
              placeholder="Template name"
              value={newTemplate.name}
              onChange={(e) =>
                setNewTemplate((prev) => ({ ...prev, name: e.target.value }))
              }
              className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
            />
            <Textarea
              placeholder="Template content (markdown)"
              value={newTemplate.content}
              onChange={(e) =>
                setNewTemplate((prev) => ({ ...prev, content: e.target.value }))
              }
              className="min-h-[100px] font-mono text-sm"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => createMutation.mutate(newTemplate)}
                disabled={
                  !newTemplate.name || !newTemplate.content || createMutation.isPending
                }
              >
                Create
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setIsCreating(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Template list */}
        {templates?.length === 0 && !isCreating ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No templates yet
          </p>
        ) : (
          templates?.map((template) => (
            <div key={template.id} className="border rounded-lg p-4">
              {editingId === template.id ? (
                <div className="space-y-3">
                  <input
                    type="text"
                    value={editForm.name}
                    onChange={(e) =>
                      setEditForm((prev) => ({ ...prev, name: e.target.value }))
                    }
                    className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
                  />
                  <Textarea
                    value={editForm.content}
                    onChange={(e) =>
                      setEditForm((prev) => ({ ...prev, content: e.target.value }))
                    }
                    className="min-h-[100px] font-mono text-sm"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() =>
                        updateMutation.mutate({ id: template.id, ...editForm })
                      }
                      disabled={updateMutation.isPending}
                    >
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setEditingId(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{template.name}</span>
                      {template.isDefault && (
                        <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded">
                          Default
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() =>
                          setDefaultMutation.mutate({
                            id: template.isDefault ? null : template.id,
                          })
                        }
                        title={
                          template.isDefault
                            ? "Remove as default"
                            : "Set as default"
                        }
                      >
                        <Star
                          className={`h-4 w-4 ${template.isDefault ? "fill-current" : ""}`}
                        />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => startEdit(template)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        onClick={() =>
                          confirm("Delete this template?") &&
                          deleteMutation.mutate({ id: template.id })
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <pre className="text-xs text-muted-foreground bg-muted p-2 rounded overflow-x-auto whitespace-pre-wrap">
                    {template.content.slice(0, 200)}
                    {template.content.length > 200 ? "..." : ""}
                  </pre>
                </>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function NotificationsSection() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-5 w-5" />
          Notifications
        </CardTitle>
        <CardDescription>Configure notification preferences</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground text-center py-8">
          Coming soon...
        </p>
      </CardContent>
    </Card>
  );
}
