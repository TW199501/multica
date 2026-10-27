package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"slices"
	"strings"

	"github.com/spf13/cobra"

	"github.com/multica-ai/multica/server/internal/cli"
)

// Workflow commands — workspace-scoped project workflows: the statuses a
// project's board uses and what happens when an issue enters each one.

var workflowCmd = &cobra.Command{
	Use:   "workflow",
	Short: "Work with project workflows",
}

var workflowListCmd = &cobra.Command{
	Use:   "list",
	Short: "List workflows in the workspace",
	RunE:  runWorkflowList,
}

var workflowGetCmd = &cobra.Command{
	Use:   "get <id>",
	Short: "Get workflow details, including its steps",
	Args:  exactArgs(1),
	RunE:  runWorkflowGet,
}

var workflowCreateCmd = &cobra.Command{
	Use:   "create",
	Short: "Create a workflow",
	RunE:  runWorkflowCreate,
}

var workflowUpdateCmd = &cobra.Command{
	Use:   "update <id>",
	Short: "Update a workflow's name, description, or steps",
	Args:  exactArgs(1),
	RunE:  runWorkflowUpdate,
}

var workflowDeleteCmd = &cobra.Command{
	Use:   "delete <id>",
	Short: "Delete a workflow no project uses",
	Args:  exactArgs(1),
	RunE:  runWorkflowDelete,
}

var workflowHandoffCmd = &cobra.Command{
	Use:   "handoff <id> <status>",
	Short: "Set what happens when an issue enters one of a workflow's statuses",
	Long: `Set the handoff for one status of a workflow: who the issue is handed to,
the instructions their run gets, and where the handler moves it next.

Fields you do not pass keep their current value.`,
	Args: exactArgs(2),
	RunE: runWorkflowHandoff,
}

var projectWorkflowCmd = &cobra.Command{
	Use:   "workflow <project-id> <workflow-id|default>",
	Short: "Switch the workflow a project uses",
	Long: `Switch the workflow a project uses. Issues on statuses the new workflow
does not list must move: pass --map <old-status>=<new-status> for each one.
Use --dry-run to see which statuses need a mapping.`,
	Args: exactArgs(2),
	RunE: runProjectWorkflow,
}

var workflowHandlerTypes = []string{"none", "agent", "squad", "member", "project_lead", "creator"}

const workflowStepsHelp = `JSON array of steps, in board order. Each step names an existing status by
"status_key" or a status to create by "new_status": {"name","category","color"}, and may set
"handler": {"type","id"}, "instructions", "next_status_key" and "back_status_key".`

func init() {
	workflowCmd.AddCommand(workflowListCmd)
	workflowCmd.AddCommand(workflowGetCmd)
	workflowCmd.AddCommand(workflowCreateCmd)
	workflowCmd.AddCommand(workflowUpdateCmd)
	workflowCmd.AddCommand(workflowDeleteCmd)
	workflowCmd.AddCommand(workflowHandoffCmd)
	projectCmd.AddCommand(projectWorkflowCmd)

	addWorkflowListFlags(workflowListCmd)
	workflowGetCmd.Flags().String("output", "json", "Output format: table or json")
	addWorkflowCreateFlags(workflowCreateCmd)
	addWorkflowUpdateFlags(workflowUpdateCmd)
	workflowDeleteCmd.Flags().String("output", "json", "Output format: table or json")
	addWorkflowHandoffFlags(workflowHandoffCmd)
	addProjectWorkflowFlags(projectWorkflowCmd)
}

func addWorkflowListFlags(cmd *cobra.Command) {
	cmd.Flags().String("output", "table", "Output format: table or json")
	cmd.Flags().Bool("full-id", false, "Show full UUIDs in table output")
}

func addWorkflowStepsFlags(cmd *cobra.Command) {
	cmd.Flags().String("steps", "", workflowStepsHelp)
	cmd.Flags().Bool("steps-stdin", false, "Read the --steps JSON from stdin")
	cmd.Flags().String("steps-file", "", "Read the --steps JSON from a UTF-8 file. The path must be inside the current working directory unless --allow-external-file is set.")
	cmd.Flags().Bool("allow-external-file", false, "Allow --steps-file to read a path outside the current working directory")
}

func addWorkflowCreateFlags(cmd *cobra.Command) {
	cmd.Flags().String("name", "", "Workflow name (required)")
	cmd.Flags().String("description", "", "Workflow description")
	addWorkflowStepsFlags(cmd)
	cmd.Flags().String("output", "json", "Output format: table or json")
}

func addWorkflowUpdateFlags(cmd *cobra.Command) {
	cmd.Flags().String("name", "", "New name")
	cmd.Flags().String("description", "", "New description")
	addWorkflowStepsFlags(cmd)
	cmd.Flags().StringArray("map", nil, "Move issues off a status the edit removes: <old-status>=<new-status> (repeatable)")
	cmd.Flags().Bool("dry-run", false, "Validate the edit and show which statuses need --map, without saving")
	cmd.Flags().String("output", "json", "Output format: table or json")
}

func addWorkflowHandoffFlags(cmd *cobra.Command) {
	cmd.Flags().String("handler-type", "", "Who the issue is handed to: "+strings.Join(workflowHandlerTypes, ", "))
	cmd.Flags().String("handler-id", "", "Agent, squad, or member ID for --handler-type agent, squad, or member")
	cmd.Flags().String("instructions", "", "Instructions the handler's run gets")
	cmd.Flags().Bool("instructions-stdin", false, "Read --instructions from stdin")
	cmd.Flags().String("instructions-file", "", "Read --instructions from a UTF-8 file. The path must be inside the current working directory unless --allow-external-file is set.")
	cmd.Flags().Bool("allow-external-file", false, "Allow --instructions-file to read a path outside the current working directory")
	cmd.Flags().String("next", "", "Status the handler moves the issue to when done")
	cmd.Flags().String("back", "", "Status the handler moves the issue back to")
	cmd.Flags().String("copy-for-project", "", "Save the handoff on a copy of the workflow that only this project uses")
	cmd.Flags().String("output", "json", "Output format: table or json")
}

func addProjectWorkflowFlags(cmd *cobra.Command) {
	cmd.Flags().StringArray("map", nil, "Move issues off a status the new workflow does not list: <old-status>=<new-status> (repeatable)")
	cmd.Flags().Bool("dry-run", false, "Show which statuses need --map, without switching")
	cmd.Flags().String("output", "json", "Output format: table or json")
}

func runWorkflowList(cmd *cobra.Command, _ []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}
	ctx, cancel := cli.APIContext(context.Background())
	defer cancel()

	workflows, err := fetchWorkflows(ctx, client)
	if err != nil {
		return fmt.Errorf("list workflows: %w", err)
	}

	output, _ := cmd.Flags().GetString("output")
	if output == "json" {
		return cli.PrintJSON(os.Stdout, workflows)
	}

	fullID, _ := cmd.Flags().GetBool("full-id")
	headers := []string{"ID", "NAME", "DEFAULT", "STEPS", "PROJECTS"}
	rows := make([][]string, 0, len(workflows))
	for _, raw := range workflows {
		wf, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		rows = append(rows, []string{
			displayID(strVal(wf, "id"), fullID),
			strVal(wf, "name"),
			yesNo(wf["is_default"] == true),
			fmt.Sprintf("%d", len(anySlice(wf["steps"]))),
			fmt.Sprintf("%d", len(anySlice(wf["project_ids"]))),
		})
	}
	cli.PrintTable(os.Stdout, headers, rows)
	return nil
}

func runWorkflowGet(cmd *cobra.Command, args []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}
	ctx, cancel := cli.APIContext(context.Background())
	defer cancel()

	ref, err := resolveWorkflowID(ctx, client, args[0])
	if err != nil {
		return err
	}
	var workflow map[string]any
	if err := client.GetJSON(ctx, workflowPath(ref.ID), &workflow); err != nil {
		return fmt.Errorf("get workflow: %w", err)
	}
	return printWorkflow(cmd, workflow)
}

func runWorkflowCreate(cmd *cobra.Command, _ []string) error {
	name, _ := cmd.Flags().GetString("name")
	if strings.TrimSpace(name) == "" {
		return fmt.Errorf("--name is required")
	}
	body := map[string]any{"name": name}
	if v, _ := cmd.Flags().GetString("description"); v != "" {
		body["description"] = v
	}
	steps, ok, err := resolveWorkflowSteps(cmd)
	if err != nil {
		return err
	}
	if ok {
		body["steps"] = steps
	}

	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}
	ctx, cancel := cli.APIContext(context.Background())
	defer cancel()

	var result map[string]any
	if err := client.PostJSON(ctx, "/api/issue-workflows", body, &result); err != nil {
		return fmt.Errorf("create workflow: %w", err)
	}
	return printWorkflow(cmd, result)
}

func runWorkflowUpdate(cmd *cobra.Command, args []string) error {
	body := map[string]any{}
	if v, _ := cmd.Flags().GetString("name"); v != "" {
		body["name"] = v
	}
	if cmd.Flags().Changed("description") {
		v, _ := cmd.Flags().GetString("description")
		body["description"] = v
	}
	steps, ok, err := resolveWorkflowSteps(cmd)
	if err != nil {
		return err
	}
	if ok {
		body["steps"] = steps
	}
	if len(body) == 0 {
		return fmt.Errorf("nothing to update — provide --name, --description, and/or --steps")
	}
	mapping, err := statusMappingFlag(cmd)
	if err != nil {
		return err
	}
	if len(mapping) > 0 {
		body["status_mapping"] = mapping
	}
	dryRun, _ := cmd.Flags().GetBool("dry-run")
	if dryRun {
		body["dry_run"] = true
	}

	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}
	ctx, cancel := cli.APIContext(context.Background())
	defer cancel()

	ref, err := resolveWorkflowID(ctx, client, args[0])
	if err != nil {
		return err
	}
	var result map[string]any
	if err := client.PatchJSON(ctx, workflowPath(ref.ID), body, &result); err != nil {
		return statusMappingError("update workflow", err)
	}
	if dryRun {
		return printMappingPlan(cmd, result)
	}
	return printWorkflow(cmd, result)
}

func runWorkflowDelete(cmd *cobra.Command, args []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}
	ctx, cancel := cli.APIContext(context.Background())
	defer cancel()

	ref, err := resolveWorkflowID(ctx, client, args[0])
	if err != nil {
		return err
	}
	if err := client.DeleteJSON(ctx, workflowPath(ref.ID)); err != nil {
		return fmt.Errorf("delete workflow: %w", err)
	}
	if output, _ := cmd.Flags().GetString("output"); output == "json" {
		return cli.PrintJSON(os.Stdout, map[string]any{"id": ref.ID, "deleted": true})
	}
	fmt.Fprintf(os.Stdout, "Workflow %s deleted.\n", ref.Display)
	return nil
}

func runWorkflowHandoff(cmd *cobra.Command, args []string) error {
	statusKey := strings.TrimSpace(args[1])
	handlerType, _ := cmd.Flags().GetString("handler-type")
	if handlerType != "" && !slices.Contains(workflowHandlerTypes, handlerType) {
		return fmt.Errorf("--handler-type must be one of: %s", strings.Join(workflowHandlerTypes, ", "))
	}
	instructions, hasInstructions, err := resolveTextFlag(cmd, "instructions")
	if err != nil {
		return err
	}

	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}
	ctx, cancel := cli.APIContext(context.Background())
	defer cancel()

	ref, err := resolveWorkflowID(ctx, client, args[0])
	if err != nil {
		return err
	}
	var workflow map[string]any
	if err := client.GetJSON(ctx, workflowPath(ref.ID), &workflow); err != nil {
		return fmt.Errorf("get workflow: %w", err)
	}
	step := findWorkflowStep(workflow, statusKey)
	if step == nil {
		return fmt.Errorf("workflow %s has no %q status; run `multica workflow get %s` to list its statuses", ref.Display, statusKey, args[0])
	}

	body := handoffRequestBody(step)
	handler := body["handler"].(map[string]any)
	if handlerType != "" {
		handler["type"] = handlerType
		if !cmd.Flags().Changed("handler-id") {
			delete(handler, "id")
		}
	}
	if cmd.Flags().Changed("handler-id") {
		v, _ := cmd.Flags().GetString("handler-id")
		handler["id"] = v
	}
	if hasInstructions {
		body["instructions"] = instructions
	}
	if cmd.Flags().Changed("next") {
		v, _ := cmd.Flags().GetString("next")
		body["next_status_key"] = v
	}
	if cmd.Flags().Changed("back") {
		v, _ := cmd.Flags().GetString("back")
		body["back_status_key"] = v
	}
	if v, _ := cmd.Flags().GetString("copy-for-project"); v != "" {
		projectRef, err := resolveProjectID(ctx, client, v)
		if err != nil {
			return fmt.Errorf("resolve project: %w", err)
		}
		body["copy_for_project_id"] = projectRef.ID
	}

	var result map[string]any
	path := workflowPath(ref.ID) + "/handoffs/" + url.PathEscape(statusKey)
	if err := client.PutJSON(ctx, path, body, &result); err != nil {
		return fmt.Errorf("set handoff: %w", err)
	}
	return printWorkflow(cmd, result)
}

func runProjectWorkflow(cmd *cobra.Command, args []string) error {
	mapping, err := statusMappingFlag(cmd)
	if err != nil {
		return err
	}
	dryRun, _ := cmd.Flags().GetBool("dry-run")

	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}
	ctx, cancel := cli.APIContext(context.Background())
	defer cancel()

	projectRef, err := resolveProjectID(ctx, client, args[0])
	if err != nil {
		return fmt.Errorf("resolve project: %w", err)
	}
	body := map[string]any{"workflow_id": nil}
	if !strings.EqualFold(strings.TrimSpace(args[1]), "default") {
		ref, err := resolveWorkflowID(ctx, client, args[1])
		if err != nil {
			return err
		}
		body["workflow_id"] = ref.ID
	}
	if len(mapping) > 0 {
		body["status_mapping"] = mapping
	}
	if dryRun {
		body["dry_run"] = true
	}

	var result map[string]any
	if err := client.PostJSON(ctx, "/api/projects/"+url.PathEscape(projectRef.ID)+"/workflow", body, &result); err != nil {
		return statusMappingError("switch project workflow", err)
	}
	if dryRun {
		return printMappingPlan(cmd, result)
	}

	output, _ := cmd.Flags().GetString("output")
	if output == "table" {
		project, _ := result["project"].(map[string]any)
		workflowID := strVal(project, "workflow_id")
		if workflowID == "" {
			workflowID = "default"
		}
		cli.PrintTable(os.Stdout,
			[]string{"PROJECT", "WORKFLOW", "MOVED ISSUES"},
			[][]string{{strVal(project, "title"), workflowID, numValOrZero(result, "updated_issues")}},
		)
		return nil
	}
	return cli.PrintJSON(os.Stdout, result)
}

func workflowPath(id string) string {
	return "/api/issue-workflows/" + url.PathEscape(id)
}

func fetchWorkflows(ctx context.Context, client *cli.APIClient) ([]any, error) {
	var result map[string]any
	if err := client.GetJSON(ctx, "/api/issue-workflows", &result); err != nil {
		return nil, err
	}
	workflows, _ := result["workflows"].([]any)
	if workflows == nil {
		workflows = []any{}
	}
	return workflows, nil
}

// resolveWorkflowID accepts a full UUID, a UUID prefix, or a workflow name
// (case-insensitive).
func resolveWorkflowID(ctx context.Context, client *cli.APIClient, input string) (resolvedID, error) {
	trimmed := strings.TrimSpace(input)
	if uuidRegexp.MatchString(trimmed) {
		return resolvedID{ID: trimmed, Display: trimmed}, nil
	}
	workflows, err := fetchWorkflows(ctx, client)
	if err != nil {
		return resolvedID{}, fmt.Errorf("resolve workflow: %w", err)
	}
	candidates := make([]idCandidate, 0, len(workflows))
	for _, raw := range workflows {
		wf, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		c := idCandidate{ID: strVal(wf, "id"), Display: strVal(wf, "name")}
		if strings.EqualFold(c.Display, trimmed) {
			return resolvedID{ID: c.ID, Display: c.Display}, nil
		}
		candidates = append(candidates, c)
	}
	ref, err := resolveIDByPrefix(ctx, client, "workflow", trimmed, func(context.Context, *cli.APIClient) ([]idCandidate, error) {
		return candidates, nil
	})
	if err != nil {
		return resolvedID{}, fmt.Errorf("%w (a workflow name also works)", err)
	}
	return ref, nil
}

// resolveWorkflowSteps reads --steps / --steps-stdin / --steps-file and checks
// it is a JSON array, so a malformed file fails before any request is sent.
func resolveWorkflowSteps(cmd *cobra.Command) ([]any, bool, error) {
	raw, ok, err := resolveTextFlag(cmd, "steps")
	if err != nil || !ok {
		return nil, ok, err
	}
	var steps []any
	if err := json.Unmarshal([]byte(raw), &steps); err != nil {
		return nil, false, fmt.Errorf("--steps must be a JSON array of steps: %w", err)
	}
	return steps, true, nil
}

func statusMappingFlag(cmd *cobra.Command) (map[string]string, error) {
	pairs, _ := cmd.Flags().GetStringArray("map")
	return parseStatusMapping(pairs)
}

func parseStatusMapping(pairs []string) (map[string]string, error) {
	mapping := make(map[string]string, len(pairs))
	for _, pair := range pairs {
		from, to, ok := strings.Cut(pair, "=")
		from, to = strings.TrimSpace(from), strings.TrimSpace(to)
		if !ok || from == "" || to == "" {
			return nil, fmt.Errorf("--map %q must look like <old-status>=<new-status>", pair)
		}
		if _, dup := mapping[from]; dup {
			return nil, fmt.Errorf("--map names %q more than once", from)
		}
		mapping[from] = to
	}
	return mapping, nil
}

// statusMappingError turns the server's "mapping required" conflict into a
// message listing each status to map and the server's suggested target.
func statusMappingError(action string, err error) error {
	var httpErr *cli.HTTPError
	if !errors.As(err, &httpErr) || httpErr.StatusCode != http.StatusConflict {
		return fmt.Errorf("%s: %w", action, err)
	}
	var body struct {
		Error string `json:"error"`
		Code  string `json:"code"`
		Plan  struct {
			Required []struct {
				StatusKey          string `json:"status_key"`
				IssueCount         int64  `json:"issue_count"`
				SuggestedStatusKey string `json:"suggested_status_key"`
			} `json:"required"`
		} `json:"plan"`
	}
	if json.Unmarshal([]byte(httpErr.Body), &body) != nil || body.Code != "workflow_status_mapping_required" {
		return fmt.Errorf("%s: %w", action, err)
	}
	var b strings.Builder
	fmt.Fprintf(&b, "%s: %s.\nIssues on these statuses must move; pass --map for each:", action, body.Error)
	maps := make([]string, 0, len(body.Plan.Required))
	for _, r := range body.Plan.Required {
		fmt.Fprintf(&b, "\n  %s (%d issue(s)) → suggested %s", r.StatusKey, r.IssueCount, r.SuggestedStatusKey)
		maps = append(maps, "--map "+r.StatusKey+"="+r.SuggestedStatusKey)
	}
	if len(maps) > 0 {
		fmt.Fprintf(&b, "\nTo accept the suggestions: %s", strings.Join(maps, " "))
	}
	return cli.WithUserMessage(b.String(), err)
}

func findWorkflowStep(workflow map[string]any, statusKey string) map[string]any {
	for _, raw := range anySlice(workflow["steps"]) {
		step, ok := raw.(map[string]any)
		if ok && strVal(step, "status_key") == statusKey {
			return step
		}
	}
	return nil
}

// handoffRequestBody starts from the step's current handoff: the server
// replaces the whole handoff, so unchanged fields must be sent back.
func handoffRequestBody(step map[string]any) map[string]any {
	handler := map[string]any{"type": "none"}
	if current, ok := step["handler"].(map[string]any); ok {
		if v := strVal(current, "type"); v != "" {
			handler["type"] = v
		}
		if v := strVal(current, "id"); v != "" {
			handler["id"] = v
		}
	}
	return map[string]any{
		"handler":         handler,
		"instructions":    strVal(step, "instructions"),
		"next_status_key": strVal(step, "next_status_key"),
		"back_status_key": strVal(step, "back_status_key"),
	}
}

func printWorkflow(cmd *cobra.Command, workflow map[string]any) error {
	output, _ := cmd.Flags().GetString("output")
	if output != "table" {
		return cli.PrintJSON(os.Stdout, workflow)
	}
	cli.PrintTable(os.Stdout,
		[]string{"ID", "NAME", "DEFAULT", "PROJECTS"},
		[][]string{{
			strVal(workflow, "id"),
			strVal(workflow, "name"),
			yesNo(workflow["is_default"] == true),
			fmt.Sprintf("%d", len(anySlice(workflow["project_ids"]))),
		}},
	)
	fmt.Fprintln(os.Stdout)
	rows := [][]string{}
	for _, raw := range anySlice(workflow["steps"]) {
		step, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		handler, _ := step["handler"].(map[string]any)
		handlerLabel := strVal(handler, "type")
		if id := strVal(handler, "id"); id != "" {
			handlerLabel += " " + truncateID(id)
		}
		rows = append(rows, []string{
			strVal(step, "status_key"),
			handlerLabel,
			strVal(step, "next_status_key"),
			strVal(step, "back_status_key"),
		})
	}
	cli.PrintTable(os.Stdout, []string{"STATUS", "HANDLER", "NEXT", "BACK"}, rows)
	return nil
}

func printMappingPlan(cmd *cobra.Command, result map[string]any) error {
	output, _ := cmd.Flags().GetString("output")
	if output != "table" {
		return cli.PrintJSON(os.Stdout, result)
	}
	plan, _ := result["plan"].(map[string]any)
	rows := [][]string{}
	for _, raw := range anySlice(plan["required"]) {
		r, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		rows = append(rows, []string{strVal(r, "status_key"), numValOrZero(r, "issue_count"), strVal(r, "suggested_status_key")})
	}
	if len(rows) == 0 {
		fmt.Fprintln(os.Stdout, "No issues need to move.")
		return nil
	}
	cli.PrintTable(os.Stdout, []string{"STATUS", "ISSUES", "SUGGESTED"}, rows)
	return nil
}

func anySlice(v any) []any {
	s, _ := v.([]any)
	return s
}

func numValOrZero(m map[string]any, key string) string {
	if v := numVal(m, key); v != "" {
		return v
	}
	return "0"
}

func yesNo(b bool) string {
	if b {
		return "yes"
	}
	return "no"
}
