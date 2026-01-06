import { createRootRoute, Outlet, Link } from "@tanstack/react-router";
import { BookOpen, Calendar, Settings } from "lucide-react";

export const rootRoute = createRootRoute({
  component: () => (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <nav className="container mx-auto px-4 h-14 flex items-center justify-between">
          <Link
            to="/"
            className="font-bold text-lg text-foreground hover:text-primary transition-colors"
          >
            TIL Stack
          </Link>
          <div className="flex items-center gap-1">
            <Link
              to="/"
              className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors [&.active]:bg-accent [&.active]:text-foreground"
            >
              <BookOpen className="h-4 w-4" />
              <span className="hidden sm:inline">Today</span>
            </Link>
            <Link
              to="/monthly"
              className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors [&.active]:bg-accent [&.active]:text-foreground"
            >
              <Calendar className="h-4 w-4" />
              <span className="hidden sm:inline">Monthly</span>
            </Link>
            <Link
              to="/config"
              className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors [&.active]:bg-accent [&.active]:text-foreground"
            >
              <Settings className="h-4 w-4" />
              <span className="hidden sm:inline">Settings</span>
            </Link>
          </div>
        </nav>
      </header>
      <main className="flex-1 container mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  ),
});
