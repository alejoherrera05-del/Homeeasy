using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Effects;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Forms = System.Windows.Forms;
using Drawing = System.Drawing;

namespace HomeEasy.PentagramaAgent.UI
{
    internal sealed class AgentState
    {
        public string Level = "error";
        public string Title = "Agente desconectado";
        public string Detail = "El servicio no está enviando heartbeat.";
        public string Version = "desconocida";
        public bool BrowserConnected;
        public IDictionary<string, object> Update;
    }

    internal static class JsonFiles
    {
        private static readonly JavaScriptSerializer Serializer = new JavaScriptSerializer();

        public static IDictionary<string, object> Read(string path)
        {
            try
            {
                if (!File.Exists(path)) return null;
                return Serializer.DeserializeObject(File.ReadAllText(path)) as IDictionary<string, object>;
            }
            catch { return null; }
        }

        public static string Text(IDictionary<string, object> source, string key)
        {
            object value;
            return source != null && source.TryGetValue(key, out value) && value != null ? Convert.ToString(value) : "";
        }

        public static bool Boolean(IDictionary<string, object> source, string key)
        {
            object value;
            return source != null && source.TryGetValue(key, out value) && value != null && Convert.ToBoolean(value);
        }

        public static bool IsFresh(IDictionary<string, object> source, int seconds)
        {
            DateTimeOffset updated;
            return DateTimeOffset.TryParse(Text(source, "updatedAt"), out updated) &&
                   DateTimeOffset.Now - updated.ToLocalTime() < TimeSpan.FromSeconds(seconds);
        }
    }

    internal sealed class AgentStateReader
    {
        private readonly string root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "HomeEasy", "PentagramaAgent");

        public string LogsPath { get { return Path.Combine(root, "logs"); } }

        public AgentState Read()
        {
            var health = JsonFiles.Read(Path.Combine(root, "runtime-health.json"));
            var update = JsonFiles.Read(Path.Combine(root, "update-status.json"));
            var browser = JsonFiles.Read(Path.Combine(root, "browser-bridge-status.json"));
            var state = new AgentState
            {
                Version = string.IsNullOrWhiteSpace(JsonFiles.Text(health, "version")) ? "desconocida" : JsonFiles.Text(health, "version"),
                BrowserConnected = JsonFiles.Boolean(browser, "connected") && JsonFiles.IsFresh(browser, 120),
                Update = update
            };
            if (!JsonFiles.IsFresh(health, 120)) return state;

            var status = JsonFiles.Text(health, "status");
            var code = JsonFiles.Text(health, "code");
            if (status == "recovering" || status == "error")
            {
                state.Level = "warning";
                state.Title = "Reconectando";
                state.Detail = string.IsNullOrWhiteSpace(code) ? "Restableciendo la conexión de forma automática." : "Código: " + code;
                return state;
            }
            if (status == "running")
            {
                state.Level = "working";
                state.Title = "Actualizando información";
                state.Detail = "Proceso seguro en curso: " + JsonFiles.Text(health, "jobType");
                return state;
            }
            state.Level = "ok";
            state.Title = "Sistema operativo";
            state.Detail = "Conectado y listo para trabajar.";
            return state;
        }
    }

    internal sealed class PremiumButton : Button
    {
        public PremiumButton(string text, bool primary)
        {
            Content = text;
            Height = 46;
            Padding = new Thickness(22, 0, 22, 0);
            FontFamily = new FontFamily("Segoe UI");
            FontSize = 14;
            FontWeight = FontWeights.SemiBold;
            Cursor = Cursors.Hand;
            BorderThickness = new Thickness(1);
            Background = new SolidColorBrush((Color)ColorConverter.ConvertFromString(primary ? "#9E3155" : "#FFFFFF"));
            Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString(primary ? "#FFFFFF" : "#4A3540"));
            BorderBrush = new SolidColorBrush((Color)ColorConverter.ConvertFromString(primary ? "#9E3155" : "#D8C5CD"));
            Effect = new DropShadowEffect { BlurRadius = primary ? 18 : 10, ShadowDepth = 3, Opacity = primary ? .22 : .10, Color = Colors.Black };
            Template = BuildTemplate();
        }

        private static ControlTemplate BuildTemplate()
        {
            var template = new ControlTemplate(typeof(Button));
            var border = new FrameworkElementFactory(typeof(Border));
            border.SetValue(Border.CornerRadiusProperty, new CornerRadius(9));
            border.SetBinding(Border.BackgroundProperty, new System.Windows.Data.Binding("Background") { RelativeSource = System.Windows.Data.RelativeSource.TemplatedParent });
            border.SetBinding(Border.BorderBrushProperty, new System.Windows.Data.Binding("BorderBrush") { RelativeSource = System.Windows.Data.RelativeSource.TemplatedParent });
            border.SetBinding(Border.BorderThicknessProperty, new System.Windows.Data.Binding("BorderThickness") { RelativeSource = System.Windows.Data.RelativeSource.TemplatedParent });
            var content = new FrameworkElementFactory(typeof(ContentPresenter));
            content.SetValue(ContentPresenter.HorizontalAlignmentProperty, HorizontalAlignment.Center);
            content.SetValue(ContentPresenter.VerticalAlignmentProperty, VerticalAlignment.Center);
            border.AppendChild(content);
            template.VisualTree = border;
            return template;
        }
    }

    internal sealed class MainWindow : Window
    {
        private static readonly Brush Burgundy = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#9E3155"));
        private static readonly Brush BurgundyDark = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#74223E"));
        private static readonly Brush Gold = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#D5AF53"));
        private static readonly Brush Ink = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#30252B"));
        private static readonly Brush Muted = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#786B72"));
        private static readonly Brush CanvasBrush = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#F8F4F6"));
        private readonly AgentStateReader reader;
        private readonly TextBlock statusTitle;
        private readonly TextBlock statusDetail;
        private readonly TextBlock versionText;
        private readonly TextBlock browserText;
        private readonly TextBlock updateText;
        private readonly Border statusIcon;
        private readonly Forms.NotifyIcon tray;
        private readonly DispatcherTimer timer;
        private string lastUpdateNotice = "";
        private bool exiting;

        public MainWindow(AgentStateReader stateReader, string appRoot)
        {
            reader = stateReader;
            Title = "HomeEasy · Pentagrama Agent";
            Width = 920;
            Height = 650;
            MinWidth = 920;
            MinHeight = 650;
            WindowStartupLocation = WindowStartupLocation.CenterScreen;
            ResizeMode = ResizeMode.CanMinimize;
            WindowStyle = WindowStyle.None;
            Background = CanvasBrush;
            FontFamily = new FontFamily("Segoe UI");
            UseLayoutRounding = true;
            SnapsToDevicePixels = true;
            var iconPath = Path.Combine(appRoot, "assets", "homeeasy-agent.ico");
            var logoPath = Path.Combine(appRoot, "assets", "homeeasy-logo.png");
            if (File.Exists(iconPath)) Icon = BitmapFrame.Create(new Uri(iconPath));

            var root = new Grid();
            root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(72) });
            root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            Content = root;
            root.Children.Add(BuildHeader(logoPath));

            var content = new StackPanel { Margin = new Thickness(34, 24, 34, 22) };
            Grid.SetRow(content, 1);
            root.Children.Add(content);

            var statusCard = Card(20, 24, 22, 24);
            statusCard.Height = 306;
            statusCard.BorderBrush = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#E3D3D9"));
            statusCard.BorderThickness = new Thickness(1, 1, 1, 2);
            statusCard.Effect = new DropShadowEffect { BlurRadius = 28, ShadowDepth = 8, Opacity = .13, Color = (Color)ColorConverter.ConvertFromString("#5A243A") };
            var statusGrid = new Grid();
            statusGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            statusGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            var statusCopy = new StackPanel { VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Center };
            statusIcon = new Border { Width = 80, Height = 80, CornerRadius = new CornerRadius(40), Background = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#E7F6ED")), BorderBrush = Gold, BorderThickness = new Thickness(2), HorizontalAlignment = HorizontalAlignment.Center, Effect = new DropShadowEffect { BlurRadius = 16, ShadowDepth = 5, Opacity = .22, Color = Colors.Black } };
            statusIcon.Child = Glyph("\uE73E", 36, "#187A45");
            statusCopy.Children.Add(statusIcon);
            statusTitle = Copy("Comprobando estado…", 30, FontWeights.SemiBold, Ink);
            statusTitle.HorizontalAlignment = HorizontalAlignment.Center;
            statusTitle.Margin = new Thickness(0, 11, 0, 0);
            statusDetail = Copy("Validando la conexión segura.", 16, FontWeights.Normal, Muted);
            statusDetail.HorizontalAlignment = HorizontalAlignment.Center;
            statusDetail.Margin = new Thickness(0, 3, 0, 0);
            statusCopy.Children.Add(statusTitle);
            statusCopy.Children.Add(statusDetail);
            statusGrid.Children.Add(statusCopy);

            var capsules = new Grid { Margin = new Thickness(0, 14, 0, 0) };
            capsules.ColumnDefinitions.Add(new ColumnDefinition());
            capsules.ColumnDefinitions.Add(new ColumnDefinition());
            capsules.ColumnDefinitions.Add(new ColumnDefinition());
            versionText = Capsule(capsules, 0, "\uE7BA", "Agent verificando…");
            browserText = Capsule(capsules, 1, "\uE774", "Extensión verificando…");
            updateText = Capsule(capsules, 2, "\uE895", "Actualizaciones activas");
            Grid.SetRow(capsules, 1);
            statusGrid.Children.Add(capsules);
            statusCard.Child = statusGrid;
            content.Children.Add(statusCard);

            var connection = Card(16, 20, 18, 20);
            connection.Margin = new Thickness(0, 18, 0, 0);
            connection.Height = 98;
            connection.Effect = new DropShadowEffect { BlurRadius = 18, ShadowDepth = 5, Opacity = .10, Color = Colors.Black };
            var connectionGrid = new Grid();
            connectionGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(58) });
            connectionGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            connectionGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var lockIcon = new Border { Width = 46, Height = 46, CornerRadius = new CornerRadius(12), Background = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#F5E9EE")), VerticalAlignment = VerticalAlignment.Center };
            lockIcon.Child = Glyph("\uE72E", 20, "#9E3155");
            connectionGrid.Children.Add(lockIcon);
            var connectionCopy = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
            connectionCopy.Children.Add(Copy("Conexión Pentagrama", 17, FontWeights.SemiBold, Ink));
            var protectedText = Copy("Cuenta administrada · Credenciales protegidas por HomeEasy", 12.5, FontWeights.Normal, Muted);
            protectedText.Margin = new Thickness(0, 4, 0, 0);
            connectionCopy.Children.Add(protectedText);
            Grid.SetColumn(connectionCopy, 1);
            connectionGrid.Children.Add(connectionCopy);
            var configure = new PremiumButton("Configurar acceso", false) { Height = 42, FontSize = 13, Margin = new Thickness(18, 0, 0, 0) };
            configure.Click += delegate { OpenExternal("https://hommy.homeeasy.com.co/configuracion.html?section=pentagrama"); };
            Grid.SetColumn(configure, 2);
            connectionGrid.Children.Add(configure);
            connection.Child = connectionGrid;
            content.Children.Add(connection);

            var footer = new Grid { Margin = new Thickness(0, 20, 0, 0) };
            footer.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            footer.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            footer.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(24) });
            footer.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var diagnosis = new PremiumButton("Ver diagnóstico", false);
            diagnosis.Click += delegate { Directory.CreateDirectory(reader.LogsPath); OpenExternal(reader.LogsPath); };
            Grid.SetColumn(diagnosis, 1);
            footer.Children.Add(diagnosis);
            var openHomeEasy = new PremiumButton("Abrir HomeEasy", true) { MinWidth = 190 };
            openHomeEasy.Click += delegate { OpenExternal("https://hommy.homeeasy.com.co/configuracion.html?section=pentagrama"); };
            Grid.SetColumn(openHomeEasy, 3);
            footer.Children.Add(openHomeEasy);
            content.Children.Add(footer);

            var menu = new Forms.ContextMenuStrip();
            var statusMenu = new Forms.ToolStripMenuItem("Comprobando estado…") { Enabled = false };
            menu.Items.Add(statusMenu);
            menu.Items.Add(new Forms.ToolStripSeparator());
            menu.Items.Add("Ver estado", null, delegate { ShowFromTray(); });
            menu.Items.Add("Abrir HomeEasy", null, delegate { OpenExternal("https://hommy.homeeasy.com.co/configuracion.html?section=pentagrama"); });
            menu.Items.Add("Actualizaciones automáticas activas").Enabled = false;
            menu.Items.Add(new Forms.ToolStripSeparator());
            menu.Items.Add("Cerrar icono", null, delegate { exiting = true; tray.Visible = false; Close(); Application.Current.Shutdown(); });
            tray = new Forms.NotifyIcon { Text = "HomeEasy Pentagrama Agent", ContextMenuStrip = menu, Visible = true };
            if (File.Exists(iconPath)) tray.Icon = new Drawing.Icon(iconPath);
            tray.DoubleClick += delegate { ShowFromTray(); };

            Closing += delegate(object sender, System.ComponentModel.CancelEventArgs args)
            {
                if (!exiting) { args.Cancel = true; Hide(); }
            };
            timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(5) };
            timer.Tick += delegate { RefreshState(statusMenu); };
            timer.Start();
            RefreshState(statusMenu);
        }

        private UIElement BuildHeader(string logoPath)
        {
            var header = new Grid { Background = Burgundy };
            header.Effect = new DropShadowEffect { BlurRadius = 18, ShadowDepth = 5, Opacity = .20, Color = (Color)ColorConverter.ConvertFromString("#4F122A") };
            header.MouseLeftButtonDown += delegate(object sender, MouseButtonEventArgs args) { if (args.ButtonState == MouseButtonState.Pressed) DragMove(); };
            header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(88) });
            header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(52) });
            header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(52) });
            var logoFrame = new Border { Width = 56, Height = 56, CornerRadius = new CornerRadius(28), BorderBrush = Gold, BorderThickness = new Thickness(2), Background = BurgundyDark, VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Right };
            if (File.Exists(logoPath)) logoFrame.Child = new Image { Source = new BitmapImage(new Uri(logoPath)), Stretch = Stretch.Uniform, Margin = new Thickness(5) };
            header.Children.Add(logoFrame);
            var brand = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(18, 0, 0, 0) };
            var divider = new Border { Width = 1, Height = 36, Background = Gold, Margin = new Thickness(0, 0, 18, 0) };
            brand.Children.Add(divider);
            brand.Children.Add(Copy("HomeEasy Pentagrama Agent", 23, FontWeights.SemiBold, Brushes.White));
            Grid.SetColumn(brand, 1);
            header.Children.Add(brand);
            var minimize = HeaderButton("\uE921");
            minimize.Click += delegate { WindowState = WindowState.Minimized; };
            Grid.SetColumn(minimize, 2);
            header.Children.Add(minimize);
            var close = HeaderButton("\uE8BB");
            close.Click += delegate { Hide(); };
            Grid.SetColumn(close, 3);
            header.Children.Add(close);
            var goldLine = new Border { Height = 2, Background = Gold, VerticalAlignment = VerticalAlignment.Bottom };
            Grid.SetColumnSpan(goldLine, 4);
            header.Children.Add(goldLine);
            return header;
        }

        private static Button HeaderButton(string glyph)
        {
            var button = new Button
            {
                Content = glyph,
                FontFamily = new FontFamily("Segoe MDL2 Assets"),
                FontSize = 14,
                Foreground = Brushes.White,
                Background = Brushes.Transparent,
                BorderThickness = new Thickness(0),
                VerticalAlignment = VerticalAlignment.Stretch,
                HorizontalAlignment = HorizontalAlignment.Stretch,
                Cursor = Cursors.Hand
            };
            button.Template = PremiumButtonTemplate(new CornerRadius(0));
            return button;
        }

        private static ControlTemplate PremiumButtonTemplate(CornerRadius radius)
        {
            var template = new ControlTemplate(typeof(Button));
            var border = new FrameworkElementFactory(typeof(Border));
            border.SetValue(Border.CornerRadiusProperty, radius);
            border.SetBinding(Border.BackgroundProperty, new System.Windows.Data.Binding("Background") { RelativeSource = System.Windows.Data.RelativeSource.TemplatedParent });
            var content = new FrameworkElementFactory(typeof(ContentPresenter));
            content.SetValue(ContentPresenter.HorizontalAlignmentProperty, HorizontalAlignment.Center);
            content.SetValue(ContentPresenter.VerticalAlignmentProperty, VerticalAlignment.Center);
            border.AppendChild(content);
            template.VisualTree = border;
            return template;
        }

        private static Border Card(double radius, double left, double top, double right)
        {
            return new Border
            {
                Background = Brushes.White,
                BorderBrush = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#E9DDE2")),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(radius),
                Padding = new Thickness(left, top, right, top)
            };
        }

        private static TextBlock Copy(string text, double size, FontWeight weight, Brush color)
        {
            var block = new TextBlock { Text = text, FontSize = size, FontWeight = weight, Foreground = color, TextWrapping = TextWrapping.Wrap };
            TextOptions.SetTextFormattingMode(block, TextFormattingMode.Display);
            TextOptions.SetTextRenderingMode(block, TextRenderingMode.ClearType);
            return block;
        }

        private static TextBlock Glyph(string glyph, double size, string color)
        {
            return new TextBlock { Text = glyph, FontFamily = new FontFamily("Segoe MDL2 Assets"), FontSize = size, Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString(color)), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        }

        private static TextBlock Capsule(Grid parent, int column, string glyph, string text)
        {
            var border = Card(12, 14, 13, 14);
            border.Margin = new Thickness(column == 0 ? 0 : 7, 0, column == 2 ? 0 : 7, 0);
            border.Effect = new DropShadowEffect { BlurRadius = 14, ShadowDepth = 4, Opacity = .08, Color = Colors.Black };
            var row = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
            row.Children.Add(Glyph(glyph, 15, "#9E3155"));
            var label = Copy(text, 11.5, FontWeights.SemiBold, Ink);
            label.Margin = new Thickness(9, 0, 0, 0);
            row.Children.Add(label);
            border.Child = row;
            Grid.SetColumn(border, column);
            parent.Children.Add(border);
            return label;
        }

        private void RefreshState(Forms.ToolStripMenuItem statusMenu)
        {
            var state = reader.Read();
            statusTitle.Text = state.Title;
            statusDetail.Text = state.Detail;
            versionText.Text = "Agent " + state.Version + " online";
            browserText.Text = state.BrowserConnected ? "Extensión conectada" : "Esperando navegador";
            statusMenu.Text = state.Title;
            var fill = state.Level == "ok" ? "#E7F6ED" : state.Level == "working" ? "#FFF5D8" : state.Level == "warning" ? "#FFF0E2" : "#FBE9EC";
            var color = state.Level == "ok" ? "#187A45" : state.Level == "working" ? "#9B6A00" : state.Level == "warning" ? "#B55B12" : "#B4233F";
            statusIcon.Background = new SolidColorBrush((Color)ColorConverter.ConvertFromString(fill));
            statusIcon.Child = Glyph(state.Level == "ok" ? "\uE73E" : state.Level == "working" ? "\uE895" : "\uE7BA", 25, color);
            tray.Text = ("HomeEasy · " + state.Title).Substring(0, Math.Min(63, ("HomeEasy · " + state.Title).Length));
            NotifyUpdate(state.Update);
        }

        private void NotifyUpdate(IDictionary<string, object> update)
        {
            var state = JsonFiles.Text(update, "state");
            var version = JsonFiles.Text(update, "availableVersion");
            var key = state + ":" + version + ":" + JsonFiles.Text(update, "updatedAt");
            if (string.IsNullOrWhiteSpace(state) || key == lastUpdateNotice) return;
            lastUpdateNotice = key;
            if (state == "downloading") ShowBalloon("Nueva actualización HomeEasy", "Descargando versión " + version + " de forma segura.", Forms.ToolTipIcon.Info);
            else if (state == "installing") ShowBalloon("Actualizando HomeEasy", "El Agent se reiniciará automáticamente. No necesitas hacer nada.", Forms.ToolTipIcon.Info);
            else if (state == "failed") ShowBalloon("Actualización pendiente", "HomeEasy volverá a intentarlo automáticamente.", Forms.ToolTipIcon.Warning);
        }

        private void ShowBalloon(string title, string text, Forms.ToolTipIcon icon)
        {
            tray.BalloonTipTitle = title;
            tray.BalloonTipText = text;
            tray.BalloonTipIcon = icon;
            tray.ShowBalloonTip(5000);
        }

        public void ShowFromTray()
        {
            Show();
            WindowState = WindowState.Normal;
            Activate();
            Topmost = true;
            Topmost = false;
            Focus();
        }

        protected override void OnClosed(EventArgs e)
        {
            timer.Stop();
            tray.Visible = false;
            tray.Dispose();
            base.OnClosed(e);
        }

        private static void OpenExternal(string target)
        {
            try { Process.Start(new ProcessStartInfo(target) { UseShellExecute = true }); } catch { }
        }
    }

    internal static class Program
    {
        [STAThread]
        private static void Main(string[] args)
        {
            bool created;
            using (var mutex = new Mutex(true, "HomeEasyPentagramaAgentNativeUI", out created))
            {
                if (!created) return;
                var appRoot = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
                var application = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
                var window = new MainWindow(new AgentStateReader(), appRoot);
                application.MainWindow = window;
                var startup = Array.Exists(args, arg => string.Equals(arg, "--startup", StringComparison.OrdinalIgnoreCase));
                if (!startup) window.Show();
                application.Run();
            }
        }
    }
}
