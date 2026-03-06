import { useState, useEffect } from "react";
import { User, Mail, Phone, MapPin } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type UserProfile,
  loadProfile,
  saveProfile,
  loadBudget,
  saveBudget,
} from "@/api";

interface AccountPageProps {
  onProfileChange?: (profile: UserProfile) => void;
  onBudgetChange?: (budget: number) => void;
}

export default function AccountPage({
  onProfileChange,
  onBudgetChange,
}: AccountPageProps) {
  const [profile, setProfile] = useState<UserProfile>(() => loadProfile());
  const [budget, setBudget] = useState<number>(() => loadBudget());
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setProfile(loadProfile());
    setBudget(loadBudget());
  }, []);

  const handleSave = () => {
    saveProfile(profile);
    saveBudget(budget);
    setSaved(true);
    onProfileChange?.(profile);
    onBudgetChange?.(budget);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <User className="h-5 w-5 text-[var(--color-nvm-teal)]" />
            User Settings
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Your details for delivery. Groceries will be sent to your address.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium flex items-center gap-2">
              <User className="h-3.5 w-3.5 text-muted-foreground" />
              Name
            </label>
            <Input
              placeholder="Your name"
              value={profile.name}
              onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium flex items-center gap-2">
              <Mail className="h-3.5 w-3.5 text-muted-foreground" />
              Email
            </label>
            <Input
              type="email"
              placeholder="you@example.com"
              value={profile.email}
              onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium flex items-center gap-2">
              <Phone className="h-3.5 w-3.5 text-muted-foreground" />
              Phone
            </label>
            <Input
              type="tel"
              placeholder="+1 234 567 8900"
              value={profile.tel}
              onChange={(e) => setProfile((p) => ({ ...p, tel: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium flex items-center gap-2">
              <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
              Delivery Address
            </label>
            <Input
              placeholder="Street, city, state, zip"
              value={profile.address}
              onChange={(e) => setProfile((p) => ({ ...p, address: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Monthly Budget ($)</label>
            <Input
              type="number"
              min={0}
              step={10}
              placeholder="100"
              value={budget || ""}
              onChange={(e) => {
                const v = e.target.value;
                setBudget(v === "" ? 0 : Math.max(0, Number(v) || 0));
              }}
            />
          </div>
          <Button
            onClick={handleSave}
            className="bg-gradient-to-r from-[var(--color-nvm-teal)] to-[var(--color-nvm-lime)] text-white"
          >
            {saved ? "Saved!" : "Save Settings"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
