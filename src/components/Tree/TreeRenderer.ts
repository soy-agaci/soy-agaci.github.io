import * as d3 from 'd3';
import { D3Node } from '../../types/types';
import { get_name, is_member } from './dagWithFamilyData';
import { get_node_size, get_css_class, add_images, refresh_images } from './NodeHelpers';
import { set_multiline } from './LabelHelpers';
import { LAYOUT_CONSTANTS } from '../../constants/layout';

export class TreeRenderer {
    g: d3.Selection<SVGGElement, unknown, HTMLElement, any>;
    transition_milliseconds: number = LAYOUT_CONSTANTS.TRANSITION_DURATION_MS;

    // Callbacks
    onNodeClick: (node: D3Node, event: any) => void;
    onNodeDblClick: (node: D3Node) => void;
    onEditClick: (node: D3Node) => void;

    private clickTimer: any = null;
    private longPressTimer: any = null;
    private suppressClick = false;

    constructor(
        g: d3.Selection<SVGGElement, unknown, HTMLElement, any>,
        onNodeClick: (node: D3Node, event: any) => void,
        onNodeDblClick: (node: D3Node) => void,
        onEditClick: (node: D3Node) => void
    ) {
        this.g = g;
        this.onNodeClick = onNodeClick;
        this.onNodeDblClick = onNodeDblClick;
        this.onEditClick = onEditClick;
    }

    draw_nodes(nodes: D3Node[], current_node: D3Node) {
        // Sort in order to draw members on top of family nodes
        let nodes_to_draw = Array.from(nodes);
        nodes_to_draw.sort((node_1, node_2) => {
            let node_pair = [node_1, node_2];
            let compare = node_pair.map(is_member);
            if (compare[0] > compare[1]) return 1;
            if (compare[0] < compare[1]) return -1;
            return node_1.data > node_2.data ? 1 : -1;
        });

        // The data is connected by providing a key function
        let nodes_selected = this.g.selectAll<SVGGElement, D3Node>("g.node").data(nodes_to_draw, node => node.data);

        // Entering nodes will appear at current_node position
        let node_enter_group = nodes_selected.enter()
            .append("g")
            .attr("class", "node")
            .attr("transform", _ => "translate(" + current_node.added_data.y0 + "," + current_node.added_data.x0 + ")")
            .attr("visible", "true");

        // Add the nodes' labels
        node_enter_group.each(function (node) {
            set_multiline(d3.select(this), node, true)
        });

        const that = this;

        // Add a group that will contain the circle and the text
        let circle_group = node_enter_group.append("g")
            .attr("class", "node-content")
            .attr("cursor", node => is_member(node) ? "pointer" : null)
            .attr("role", node => is_member(node) ? "button" : null)
            .attr("tabindex", node => is_member(node) ? 0 : null)
            .attr("aria-label", node => is_member(node) ? `Kişiyi aç: ${get_name(node)}` : null)
            .on("click", (event, node) => {
                if (event.defaultPrevented) return;
                if (that.suppressClick) { that.suppressClick = false; return; }
                
                // Debounce click to allow dblclick to cancel it
                if (that.clickTimer) {
                    clearTimeout(that.clickTimer);
                    that.clickTimer = null;
                }
                
                that.clickTimer = setTimeout(() => {
                    that.clickTimer = null;
                    that.onNodeClick(node, event);
                }, 300);
            })
            .on("dblclick", (event, node) => {
                if (event.defaultPrevented) return;
                event.stopPropagation(); // Prevent zoom on double click
                
                // Cancel pending click
                if (that.clickTimer) {
                    clearTimeout(that.clickTimer);
                    that.clickTimer = null;
                }
                
                that.onNodeDblClick(node);
            })
            .on("pointerdown", (event, node) => {
                if (event.pointerType !== 'touch') return;
                that.longPressTimer = setTimeout(() => {
                    that.longPressTimer = null;
                    that.suppressClick = true;
                    that.onNodeDblClick(node);
                }, 600);
            })
            .on("pointerup pointercancel pointerleave", () => {
                if (that.longPressTimer) { clearTimeout(that.longPressTimer); that.longPressTimer = null; }
            })
            .on("keydown", (event, node) => {
                if (!is_member(node) || event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return;
                event.preventDefault();
                event.stopPropagation();
                that.onNodeClick(node, event);
            });

        // Add a circle as SVG object
        circle_group.append("circle")
            .attr("class", get_css_class)
            .attr("r", node => get_node_size() / (is_member(node) ? 1.0 : 4.0));

        // Add the images
        add_images(circle_group);

        // Add editing functionality (Pen Sign)
        node_enter_group.filter(is_member).append("g")
            .attr("class", "edit-control")
            .attr("cursor", "pointer")
            .attr("role", "button")
            .attr("tabindex", 0)
            .attr("aria-label", "Kişiyi düzenle")
            .attr("data-node-id", node => node.data)
            .on("click", (event, node) => {
                (event.currentTarget as SVGGElement).focus();
                that.onEditClick(node);
            })
            .on("keydown", (event, node) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                that.onEditClick(node);
            })
            .append("text")
            .attr("cursor", "pointer")
            .attr("class", "plus-label")
            .attr("font-size", "50%")
            .append("tspan")
            .attr("text-anchor", "middle")
            .attr("y", node => -get_node_size() / (is_member(node) ? 1.1 : 3.0))
            .attr("x", node => get_node_size() / (is_member(node) ? 1.1 : 3.0))
            .text("✎");

        // The nodes to be updated
        let node_update = node_enter_group.merge(nodes_selected);

        node_update.each(function (node) {
            const group = d3.select<SVGGElement, D3Node>(this);
            set_multiline(group, node, true);
            refresh_images(group.select<SVGGElement>('g.node-content'));
        });
        node_update.select("g.node-content")
            .attr("aria-label", node => is_member(node) ? `Kişiyi aç: ${get_name(node)}` : null);

        // Define the transition
        if (this.transition_milliseconds > 0) {
            node_update.transition()
                .duration(this.transition_milliseconds)
                .attr("transform", node => "translate(" + node.y + "," + node.x + ")");
        } else {
            node_update.attr("transform", node => "translate(" + node.y + "," + node.x + ")");
        }

        // Update highlighted status
        node_update.select("circle").attr("class", get_css_class);

        // Remove any node that becomes invisible
        let node_exit = nodes_selected.exit();
        if (this.transition_milliseconds > 0) {
            node_exit = node_exit.transition()
                .duration(this.transition_milliseconds / 5)
                .attr("visible", "false")
                .remove() as any;
        } else {
            node_exit.remove();
        }

        // Fade labels of nodes being removed
        node_exit.select("text").style("fill-opacity", 1e-6);
        // Fade circles of nodes being removed
        node_exit.select("circle").style("fill-opacity", 1e-6).style("stroke-opacity", 1e-6);
    }

    draw_links(links: any[], current_node: D3Node) {
        function get_curved_edge(s: any, d: any) {
            return `M ${s.y} ${s.x} C ${(s.y + d.y) / 2} ${s.x}, 
				${(s.y + d.y) / 2} ${d.x}, 
				${d.y} ${d.x}`;
        }

        let link = this.g.selectAll("path.link").data(links, (link: any) => link.source.data + "_" + link.target.data);

        let link_enter = link.enter().insert("path", "g").attr("class", "link").attr("d", function () {
            let o = { x: current_node.added_data.x0, y: current_node.added_data.y0 };
            return get_curved_edge(o, o);
        });

        let link_update = link_enter.merge(link as any);

        if (this.transition_milliseconds > 0) {
            link_update.transition()
                .duration(this.transition_milliseconds)
                .attr("d", (link: any) => get_curved_edge(link.source, link.target));
        } else {
            link_update.attr("d", (link: any) => get_curved_edge(link.source, link.target));
        }

        if (this.transition_milliseconds > 0) {
            link.exit().transition()
                .duration(this.transition_milliseconds / 5)
                .style("stroke-opacity", 1e-6)
                .remove();
        } else {
            link.exit().remove();
        }
    }
}
